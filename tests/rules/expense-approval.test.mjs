import { test, before, after, beforeEach, describe } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import * as fs from 'firebase/firestore';
import { makeFirestoreEnv, seedUsers, attachmentEntry, USERS } from './helpers.mjs';

let env;
const REQUEST_ID = 'expense-rules-r1';

before(async () => { env = await makeFirestoreEnv(); });
after(async () => { if (env) await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); await seedUsers(env); });

function requestRef(ctx) {
  return fs.doc(ctx.firestore(), 'expense_approval_requests', REQUEST_ID);
}

function expenseDraft(uid = 'emp1') {
  return {
    requestType: 'document', documentType: 'EXPENSE_REPORT', formType: 'expense', status: 'draft', schemaVersion: 3,
    title: 'TEST_지출결의서', description: '테스트 지출 사유 및 내역',
    payload: { kind: 'expense_report', body: { expenseType: 'material', amount: 10000, plannedDate: '2026-07-31', payee: '거래처', paymentMethod: 'bank_transfer' } },
    requesterUid: uid, requesterName: USERS[uid].name, requesterRole: USERS[uid].role,
    createdAt: fs.serverTimestamp(), submittedAt: null, updatedAt: fs.serverTimestamp(),
    reviewerUid: null, reviewerName: null, reviewedAt: null, reviewComment: null,
    rejectionReason: null, holdReason: null, approvedAt: null, appliedAt: null, appliedByUid: null, lastTransitionId: null,
    attachments: { a0: attachmentEntry(uid, REQUEST_ID, 'a0') }, attachmentCount: 1, attachmentsTotalSize: 2048
  };
}

async function seedSubmitted() {
  const parent = expenseDraft();
  parent.status = 'pending';
  parent.createdAt = fs.Timestamp.now();
  parent.submittedAt = fs.Timestamp.now();
  parent.updatedAt = fs.Timestamp.now();
  parent.lastTransitionId = 'submitted00000000001';
  const state = {
    schemaVersion: 3, documentType: 'EXPENSE_REPORT', formType: 'expense', requesterUid: 'emp1', status: 'pending',
    workflow: {
      steps: [
        { order: 0, role: 'sales', label: '담당 제출', status: 'approved', actorUid: 'emp1', actorName: USERS.emp1.name, actedAt: fs.Timestamp.now(), comment: '' },
        { order: 1, role: 'accounting', label: '회계 검토', status: 'pending', actorUid: null, actorName: null, actedAt: null, comment: '' },
        { order: 2, role: 'admin', label: '대표 승인', status: 'waiting', actorUid: null, actorName: null, actedAt: null, comment: '' }
      ], currentStep: 1, currentApproverRole: 'accounting', finalDecisionAt: null, rejection: null
    }, updatedAt: fs.Timestamp.now(), reviewerUid: null, reviewerName: null, reviewedAt: null,
    reviewComment: null, rejectionReason: null, approvedAt: null, lastTransitionId: parent.lastTransitionId
  };
  await env.withSecurityRulesDisabled(async ctx => {
    await fs.setDoc(requestRef(ctx), parent);
    await fs.setDoc(fs.doc(ctx.firestore(), 'expense_approval_requests', REQUEST_ID, 'workflow', 'state'), state);
  });
}

describe('v3 slim client rules', () => {
  test('valid evidence-backed expense draft create is allowed', async () => {
    await assertSucceeds(fs.setDoc(requestRef(env.authenticatedContext('emp1')), expenseDraft()));
  });

  test('expense draft without evidence is denied', async () => {
    const bad = expenseDraft();
    bad.attachments = {}; bad.attachmentCount = 0; bad.attachmentsTotalSize = 0;
    await assertFails(fs.setDoc(requestRef(env.authenticatedContext('emp1')), bad));
  });

  test('client cannot submit or mutate the v3 parent', async () => {
    await seedSubmitted();
    await assertFails(fs.updateDoc(requestRef(env.authenticatedContext('emp1')), { status: 'approved' }));
  });

  test('client cannot create or update workflow state', async () => {
    await seedSubmitted();
    const ctx = env.authenticatedContext('emp2');
    const ref = fs.doc(ctx.firestore(), 'expense_approval_requests', REQUEST_ID, 'workflow', 'state');
    await assertFails(fs.updateDoc(ref, { status: 'approved' }));
    await assertFails(fs.setDoc(fs.doc(ctx.firestore(), 'expense_approval_requests', REQUEST_ID, 'workflow', 'other'), { status: 'approved' }));
  });

  test('client cannot create expense history', async () => {
    await seedSubmitted();
    const ctx = env.authenticatedContext('emp2');
    await assertFails(fs.setDoc(fs.doc(ctx.firestore(), 'expense_approval_requests', REQUEST_ID, 'history', 'blockedhistory00001'), { action: 'step_approved' }));
  });

  test('client cannot create server-owned expense audit', async () => {
    const ctx = env.authenticatedContext('emp2');
    await assertFails(fs.setDoc(fs.doc(ctx.firestore(), 'audit_logs', 'blockedaudit000001'), { action: 'DOCUMENT_APPROVAL_STEP_APPROVED' }));
  });

  test('owner, accounting and admin can read workflow state', async () => {
    await seedSubmitted();
    for (const uid of ['emp1', 'emp2', 'admin1']) {
      const ctx = env.authenticatedContext(uid);
      await assertSucceeds(fs.getDoc(fs.doc(ctx.firestore(), 'expense_approval_requests', REQUEST_ID, 'workflow', 'state')));
    }
  });
});
