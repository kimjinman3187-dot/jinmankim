'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const {
  ApprovalError,
  initialExpenseState,
  isIdempotentHistory,
  transitionExpenseState,
  validTransitionId
} = require('./expense-approval-core');

initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'yongjin-enterprise' });
const db = getFirestore();
const REGION = 'asia-northeast3';

function callableError(error) {
  if (error instanceof HttpsError) return error;
  if (error instanceof ApprovalError) return new HttpsError(error.code, error.message);
  console.error('expense approval callable failed', { code: error?.code, message: error?.message });
  return new HttpsError('internal', 'expense-approval-failed');
}

function requireAuth(request) {
  if (!request.auth?.uid) throw new ApprovalError('unauthenticated', 'unauthenticated');
  return request.auth.uid;
}

function refsFor(requestId, transitionId) {
  const parentRef = db.collection('expense_approval_requests').doc(requestId);
  return {
    parentRef,
    stateRef: parentRef.collection('workflow').doc('state'),
    historyRef: parentRef.collection('history').doc(transitionId),
    auditRef: db.collection('audit_logs').doc(transitionId)
  };
}

function historyPayload({ requestId, transitionId, action, previousStatus, nextStatus, user, comment, now, step }) {
  return {
    requestId,
    transitionId,
    action,
    previousStatus,
    nextStatus,
    actorUid: user.uid,
    actorName: user.name,
    actorRole: user.role,
    comment: comment || '',
    createdAt: now,
    schemaVersion: 1,
    ...(Number.isInteger(step) ? { stepIndex: step } : {})
  };
}

function auditPayload({ requestId, transitionId, action, previousStatus, nextStatus, user, now, step }) {
  return {
    action: `DOCUMENT_APPROVAL_${action.toUpperCase()}`,
    user: user.name,
    role: user.role,
    email: user.email || '',
    uid: user.uid,
    order_id: requestId,
    details: { requestId, transitionId, documentType: 'EXPENSE_REPORT', step, previousStatus, nextStatus },
    timestamp: now.toMillis(),
    createdAt: now,
    createdAtMs: now.toMillis(),
    createdAtKst: ''
  };
}

async function loadActiveUser(tx, uid) {
  const snapshot = await tx.get(db.collection('users').doc(uid));
  if (!snapshot.exists) throw new ApprovalError('permission-denied', 'user-not-found');
  const data = snapshot.data() || {};
  return { ...data, uid, name: String(data.name || '').trim(), email: String(data.email || '') };
}

async function submitExpenseApprovalImpl(request) {
  const uid = requireAuth(request);
  const requestId = String(request.data?.requestId || '').trim();
  const transitionId = String(request.data?.transitionId || '').trim();
  if (!requestId || !validTransitionId(transitionId)) throw new ApprovalError('invalid-argument', 'invalid-request');
  const refs = refsFor(requestId, transitionId);

  return db.runTransaction(async tx => {
    const user = await loadActiveUser(tx, uid);
    const [parentSnap, stateSnap, historySnap, auditSnap] = await Promise.all([
      tx.get(refs.parentRef), tx.get(refs.stateRef), tx.get(refs.historyRef), tx.get(refs.auditRef)
    ]);
    if (!parentSnap.exists) throw new ApprovalError('not-found', 'request-not-found');
    if (historySnap.exists) {
      if (isIdempotentHistory(historySnap.data(), requestId, transitionId, uid, 'submitted') && auditSnap.exists) {
        return { ok: true, duplicate: true, status: parentSnap.data().status };
      }
      throw new ApprovalError('already-exists', 'transition-id-conflict');
    }
    if (stateSnap.exists || auditSnap.exists) throw new ApprovalError('already-exists', 'partial-transition-conflict');
    const parent = parentSnap.data() || {};
    if (user.status !== 'active' || parent.requesterUid !== uid) throw new ApprovalError('permission-denied', 'not-request-owner');
    const now = Timestamp.now();
    const state = initialExpenseState(parent, user, transitionId, now);
    tx.update(refs.parentRef, {
      status: 'pending', submittedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), lastTransitionId: transitionId
    });
    tx.create(refs.stateRef, state);
    tx.create(refs.historyRef, historyPayload({
      requestId, transitionId, action: 'submitted', previousStatus: 'draft', nextStatus: 'pending', user, comment: '', now, step: null
    }));
    tx.create(refs.auditRef, auditPayload({
      requestId, transitionId, action: 'submitted', previousStatus: 'draft', nextStatus: 'pending', user, now, step: 0
    }));
    return { ok: true, duplicate: false, status: 'pending' };
  });
}

async function transitionExpenseApprovalImpl(request) {
  const uid = requireAuth(request);
  const requestId = String(request.data?.requestId || '').trim();
  const transitionId = String(request.data?.transitionId || '').trim();
  const action = String(request.data?.action || '').trim();
  const reason = String(request.data?.reason || '');
  if (!requestId || !validTransitionId(transitionId)) throw new ApprovalError('invalid-argument', 'invalid-request');
  const refs = refsFor(requestId, transitionId);

  return db.runTransaction(async tx => {
    const user = await loadActiveUser(tx, uid);
    const [parentSnap, stateSnap, historySnap, auditSnap] = await Promise.all([
      tx.get(refs.parentRef), tx.get(refs.stateRef), tx.get(refs.historyRef), tx.get(refs.auditRef)
    ]);
    if (!parentSnap.exists || !stateSnap.exists) throw new ApprovalError('not-found', 'approval-state-not-found');
    const actionName = action === 'approved' ? 'step_approved' : action === 'rejected' ? 'step_rejected' : '';
    if (historySnap.exists) {
      if (actionName && isIdempotentHistory(historySnap.data(), requestId, transitionId, uid, actionName) && auditSnap.exists) {
        return { ok: true, duplicate: true, status: stateSnap.data().status };
      }
      throw new ApprovalError('already-exists', 'transition-id-conflict');
    }
    if (auditSnap.exists) throw new ApprovalError('already-exists', 'partial-transition-conflict');
    const now = Timestamp.now();
    const result = transitionExpenseState({ parent: parentSnap.data(), state: stateSnap.data(), user, action, reason, transitionId, now });
    tx.update(refs.stateRef, result.nextState);
    tx.create(refs.historyRef, historyPayload({
      requestId, transitionId, action: result.actionName, previousStatus: result.previousStatus,
      nextStatus: result.nextStatus, user, comment: reason.trim(), now, step: result.step
    }));
    tx.create(refs.auditRef, auditPayload({
      requestId, transitionId, action: result.actionName, previousStatus: result.previousStatus,
      nextStatus: result.nextStatus, user, now, step: result.step
    }));
    return { ok: true, duplicate: false, status: result.nextStatus, currentStep: result.nextState.workflow.currentStep };
  });
}

exports.submitExpenseApproval = onCall({ region: REGION }, async request => {
  try { return await submitExpenseApprovalImpl(request); } catch (error) { throw callableError(error); }
});

exports.transitionExpenseApproval = onCall({ region: REGION }, async request => {
  try { return await transitionExpenseApprovalImpl(request); } catch (error) { throw callableError(error); }
});

exports._test = { submitExpenseApprovalImpl, transitionExpenseApprovalImpl };
