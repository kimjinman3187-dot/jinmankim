'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { _test } = require('./index');

const db = getFirestore();

function steps(requesterUid = 'sales1') {
  return [
    { order: 0, role: 'sales', label: '담당 제출', status: 'approved', actorUid: requesterUid, actorName: '직원', actedAt: null, comment: '' },
    { order: 1, role: 'accounting', label: '회계 검토', status: 'pending', actorUid: null, actorName: null, actedAt: null, comment: '' },
    { order: 2, role: 'admin', label: '대표 승인', status: 'waiting', actorUid: null, actorName: null, actedAt: null, comment: '' }
  ];
}

function parentData(requesterUid = 'sales1') {
  const now = Timestamp.now();
  return {
    schemaVersion: 3,
    documentType: 'EXPENSE_REPORT',
    formType: 'expense',
    requestType: 'document',
    requesterUid,
    requesterName: '직원',
    requesterRole: 'sales',
    status: 'pending',
    title: 'TEST_지출결의서',
    description: '테스트 지출 사유',
    payload: { kind: 'expense_report', body: { expenseType: 'material', amount: 10000, plannedDate: '2026-07-31', payee: '거래처', paymentMethod: 'bank_transfer' } },
    attachments: { a0: { name: 'proof.pdf', storagePath: `document-approval-attachments/${requesterUid}/request/a0`, contentType: 'application/pdf', size: 1000 } },
    attachmentCount: 1,
    attachmentsTotalSize: 1000,
    createdAt: now,
    submittedAt: now,
    updatedAt: now,
    workflow: { currentStep: 1, currentApproverRole: 'accounting', steps: steps(requesterUid), finalDecisionAt: null, rejection: null },
    lastTransitionId: 'submitted00000000001'
  };
}

function stateData(parent) {
  return {
    schemaVersion: 3,
    documentType: 'EXPENSE_REPORT',
    formType: 'expense',
    requesterUid: parent.requesterUid,
    status: 'pending',
    workflow: parent.workflow,
    updatedAt: parent.updatedAt,
    reviewerUid: null,
    reviewerName: null,
    reviewedAt: null,
    reviewComment: null,
    rejectionReason: null,
    approvedAt: null,
    lastTransitionId: parent.lastTransitionId
  };
}

async function seed(requestId, { requesterUid = 'sales1', step = 1 } = {}) {
  const parent = parentData(requesterUid);
  const state = stateData(parent);
  if (step === 2) {
    state.workflow = { ...state.workflow, currentStep: 2, currentApproverRole: 'admin', steps: state.workflow.steps.map(item => ({ ...item })) };
    state.workflow.steps[1] = { ...state.workflow.steps[1], status: 'approved', actorUid: 'accounting1', actorName: '회계', actedAt: Timestamp.now() };
    state.workflow.steps[2] = { ...state.workflow.steps[2], status: 'pending' };
  }
  const batch = db.batch();
  batch.set(db.collection('users').doc('sales1'), { name: '직원', role: 'sales', status: 'active', auth_uid: 'sales1' });
  batch.set(db.collection('users').doc('accounting1'), { name: '회계', role: 'accounting', status: 'active', auth_uid: 'accounting1' });
  batch.set(db.collection('users').doc('admin1'), { name: '대표', role: 'admin', status: 'active', auth_uid: 'admin1' });
  const parentRef = db.collection('expense_approval_requests').doc(requestId);
  batch.set(parentRef, parent);
  batch.set(parentRef.collection('workflow').doc('state'), state);
  await batch.commit();
  return { parent, state, parentRef, stateRef: parentRef.collection('workflow').doc('state') };
}

function call(uid, requestId, transitionId, action = 'approved', reason = '') {
  return _test.transitionExpenseApprovalImpl({ auth: { uid }, data: { requestId, transitionId, action, reason } });
}

test('role validation blocks sales from accounting step', async () => {
  const id = 'fn-role';
  await seed(id);
  await assert.rejects(call('sales1', id, 'roleblocked00000001'), error => error.code === 'permission-denied');
});

test('self approval is blocked', async () => {
  const id = 'fn-self';
  await seed(id, { requesterUid: 'accounting1' });
  await assert.rejects(call('accounting1', id, 'selfblocked00000001'), error => error.code === 'permission-denied');
});

test('admin cannot skip the accounting step', async () => {
  const id = 'fn-skip';
  await seed(id);
  await assert.rejects(call('admin1', id, 'skipblocked00000001'), error => error.code === 'permission-denied');
});

test('transitionId is idempotent and does not duplicate history or audit', async () => {
  const id = 'fn-idempotent';
  const transitionId = 'idempotent000000001';
  await seed(id);
  const first = await call('accounting1', id, transitionId);
  const second = await call('accounting1', id, transitionId);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal((await db.collection('expense_approval_requests').doc(id).collection('history').get()).size, 1);
  assert.equal((await db.collection('audit_logs').where('order_id', '==', id).get()).size, 1);
});

test('transaction rolls back every write when validation fails', async () => {
  const id = 'fn-rollback';
  const seeded = await seed(id);
  await assert.rejects(call('accounting1', id, 'rollback00000000001', 'rejected', ''), error => error.code === 'invalid-argument');
  assert.deepEqual((await seeded.stateRef.get()).data(), seeded.state);
  assert.equal((await seeded.parentRef.collection('history').get()).empty, true);
  assert.equal((await db.collection('audit_logs').where('order_id', '==', id).get()).empty, true);
});

test('parent form, amount, attachment and requester remain unchanged after admin approval', async () => {
  const id = 'fn-parent-immutable';
  const seeded = await seed(id, { step: 2 });
  const before = (await seeded.parentRef.get()).data();
  await call('admin1', id, 'adminapprove0000001');
  const after = (await seeded.parentRef.get()).data();
  assert.deepEqual(after, before);
  assert.equal((await seeded.stateRef.get()).data().status, 'approved');
});
