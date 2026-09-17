'use strict';

const VALID_ACTIONS = new Set(['approved', 'rejected']);
const STATE_KEYS = [
  'schemaVersion', 'documentType', 'formType', 'requesterUid', 'status',
  'workflow', 'updatedAt', 'reviewerUid', 'reviewerName', 'reviewedAt',
  'reviewComment', 'rejectionReason', 'approvedAt', 'lastTransitionId'
];

class ApprovalError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ApprovalError';
    this.code = code;
  }
}

function requireCondition(condition, code, message) {
  if (!condition) throw new ApprovalError(code, message);
}

function validTransitionId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
}

function assertExpenseParent(parent, user = null) {
  requireCondition(parent && parent.schemaVersion === 3, 'failed-precondition', 'invalid-schema');
  requireCondition(parent.documentType === 'EXPENSE_REPORT' && parent.formType === 'expense', 'failed-precondition', 'invalid-form');
  requireCondition(typeof parent.requesterUid === 'string' && parent.requesterUid, 'failed-precondition', 'missing-requester');
  requireCondition(parent.payload?.kind === 'expense_report', 'failed-precondition', 'invalid-payload');
  requireCondition(parent.attachments && Number.isInteger(parent.attachmentCount) && parent.attachmentCount >= 1 && parent.attachmentCount <= 5, 'failed-precondition', 'missing-evidence');
  if (user) {
    requireCondition(parent.requesterUid === user.uid, 'permission-denied', 'requester-mismatch');
    requireCondition(parent.requesterName === user.name && parent.requesterRole === user.role, 'failed-precondition', 'requester-metadata-mismatch');
    requireCondition(parent.submittedAt == null && parent.reviewerUid == null && parent.reviewerName == null && parent.reviewedAt == null, 'failed-precondition', 'invalid-draft-metadata');
    requireCondition(parent.reviewComment == null && parent.rejectionReason == null && parent.holdReason == null && parent.approvedAt == null, 'failed-precondition', 'invalid-draft-metadata');
    requireCondition(parent.appliedAt == null && parent.appliedByUid == null && parent.lastTransitionId == null, 'failed-precondition', 'invalid-draft-metadata');
  }
}

function assertActiveUser(user) {
  requireCondition(user && user.status === 'active', 'permission-denied', 'inactive-user');
  requireCondition(typeof user.uid === 'string' && user.uid, 'unauthenticated', 'missing-user');
  requireCondition(typeof user.name === 'string' && user.name.trim(), 'permission-denied', 'missing-user-name');
}

function initialExpenseState(parent, user, transitionId, now) {
  assertExpenseParent(parent, user);
  requireCondition(parent.status === 'draft', 'failed-precondition', 'not-draft');
  const workflow = {
    currentStep: 1,
    currentApproverRole: 'accounting',
    steps: [
      { order: 0, role: user.role, label: '담당 제출', status: 'approved', actorUid: user.uid, actorName: user.name, actedAt: now, comment: '' },
      { order: 1, role: 'accounting', label: '회계 검토', status: 'pending', actorUid: null, actorName: null, actedAt: null, comment: '' },
      { order: 2, role: 'admin', label: '대표 승인', status: 'waiting', actorUid: null, actorName: null, actedAt: null, comment: '' }
    ],
    finalDecisionAt: null,
    rejection: null
  };
  return {
    schemaVersion: 3,
    documentType: 'EXPENSE_REPORT',
    formType: 'expense',
    requesterUid: parent.requesterUid,
    status: 'pending',
    workflow,
    updatedAt: now,
    reviewerUid: null,
    reviewerName: null,
    reviewedAt: null,
    reviewComment: null,
    rejectionReason: null,
    approvedAt: null,
    lastTransitionId: transitionId
  };
}

function transitionExpenseState({ parent, state, user, action, reason = '', transitionId, now }) {
  assertExpenseParent(parent);
  assertActiveUser(user);
  requireCondition(VALID_ACTIONS.has(action), 'invalid-argument', 'invalid-action');
  requireCondition(validTransitionId(transitionId), 'invalid-argument', 'invalid-transition-id');
  requireCondition(state && STATE_KEYS.every(key => Object.hasOwn(state, key)), 'failed-precondition', 'invalid-state-shape');
  requireCondition(state.schemaVersion === 3 && state.formType === 'expense' && state.documentType === 'EXPENSE_REPORT', 'failed-precondition', 'invalid-state');
  requireCondition(state.requesterUid === parent.requesterUid, 'failed-precondition', 'requester-mismatch');
  requireCondition(state.status === 'pending', 'failed-precondition', 'terminal-state');
  requireCondition(parent.requesterUid !== user.uid, 'permission-denied', 'self-approval');

  const step = state.workflow?.currentStep;
  const expectedRole = step === 1 ? 'accounting' : step === 2 ? 'admin' : null;
  requireCondition(expectedRole && state.workflow.currentApproverRole === expectedRole, 'failed-precondition', 'invalid-current-step');
  requireCondition(user.role === expectedRole, 'permission-denied', 'wrong-role');
  if (step === 2) {
    requireCondition(state.workflow.steps?.[1]?.status === 'approved', 'failed-precondition', 'accounting-not-approved');
    requireCondition(state.workflow.steps[1].actorUid && state.workflow.steps[1].actorUid !== user.uid, 'permission-denied', 'separation-of-duties');
  }

  const cleanReason = String(reason || '').trim();
  requireCondition(cleanReason.length <= 500, 'invalid-argument', 'reason-too-long');
  if (action === 'rejected') requireCondition(cleanReason.length >= 2, 'invalid-argument', 'rejection-reason-required');

  const steps = state.workflow.steps.map(item => ({ ...item }));
  steps[step] = {
    ...steps[step],
    status: action,
    actorUid: user.uid,
    actorName: user.name,
    actedAt: now,
    comment: cleanReason
  };
  const financeAdvance = action === 'approved' && step === 1;
  if (financeAdvance) steps[2] = { ...steps[2], status: 'pending' };
  const nextStatus = action === 'rejected' ? 'rejected' : financeAdvance ? 'pending' : 'approved';

  const nextState = {
    ...state,
    status: nextStatus,
    workflow: {
      currentStep: financeAdvance ? 2 : step,
      currentApproverRole: financeAdvance ? 'admin' : null,
      steps,
      finalDecisionAt: financeAdvance ? null : now,
      rejection: action === 'rejected'
        ? { reason: cleanReason, actorUid: user.uid, actorName: user.name, actorRole: user.role, actedAt: now }
        : null
    },
    updatedAt: now,
    reviewerUid: user.uid,
    reviewerName: user.name,
    reviewedAt: now,
    reviewComment: action === 'approved' ? cleanReason : state.reviewComment,
    rejectionReason: action === 'rejected' ? cleanReason : state.rejectionReason,
    approvedAt: action === 'approved' && step === 2 ? now : state.approvedAt,
    lastTransitionId: transitionId
  };

  return {
    previousStatus: state.status,
    nextStatus,
    step,
    actionName: action === 'approved' ? 'step_approved' : 'step_rejected',
    nextState
  };
}

function isIdempotentHistory(history, requestId, transitionId, actorUid, actionName) {
  return Boolean(history
    && history.requestId === requestId
    && history.transitionId === transitionId
    && history.actorUid === actorUid
    && history.action === actionName);
}

module.exports = {
  ApprovalError,
  STATE_KEYS,
  assertExpenseParent,
  initialExpenseState,
  isIdempotentHistory,
  transitionExpenseState,
  validTransitionId
};
