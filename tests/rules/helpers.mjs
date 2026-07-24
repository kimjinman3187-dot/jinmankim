import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

export const PROJECT_ID = 'yongjin-enterprise';

export function firestoreRules() {
  const override = process.env.RULES_FILE;
  return readFileSync(override ? override : resolve(repoRoot, 'firestore.rules'), 'utf8');
}

export function storageRules() {
  const override = process.env.STORAGE_RULES_FILE;
  return readFileSync(override ? override : resolve(repoRoot, 'storage.rules'), 'utf8');
}

export async function makeFirestoreEnv() {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: firestoreRules() }
  });
}

export async function makeStorageEnv() {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: firestoreRules() },
    storage: { rules: storageRules() }
  });
}

// ── Seed data (written with security rules disabled) ────────────────
export const USERS = {
  emp1: { name: '홍길동', role: 'sales', status: 'active', auth_uid: 'emp1' },
  emp2: { name: '김영희', role: 'accounting', status: 'active', auth_uid: 'emp2' },
  admin1: { name: '관리자', role: 'admin', status: 'active', auth_uid: 'admin1' },
  inactive1: { name: '퇴사자', role: 'sales', status: 'inactive', auth_uid: 'inactive1' }
};

export async function seedUsers(env) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const { doc, setDoc } = await import('firebase/firestore');
    const db = ctx.firestore();
    for (const [uid, data] of Object.entries(USERS)) {
      await setDoc(doc(db, 'users', uid), data);
    }
  });
}

export function attachmentEntry(requesterUid, requestId, slot, overrides = {}) {
  return {
    slot,
    name: `evidence-${slot}.pdf`,
    storagePath: `document-approval-attachments/${requesterUid}/${requestId}/${slot}`,
    contentType: 'application/pdf',
    size: 2048,
    ...overrides
  };
}

// A valid schemaVersion-2 draft request payload for the given requester.
// `sv` = the imported firestore module (for serverTimestamp).
// `overrides` 로 attachmentCount / attachmentsTotalSize 를 조작해 (정직하지 않은 클라이언트)
// Rules 가 실제 항목 합계를 독립 검증하는지 테스트할 수 있다. (WORK29-CORRECTION D1)
export function draftRequest(sv, requesterUid, requestId, attachments, overrides = {}) {
  const attMap = attachments || {
    a0: attachmentEntry(requesterUid, requestId, 'a0')
  };
  const totalSize = Object.values(attMap).reduce((sum, a) => sum + a.size, 0);
  return {
    requestType: 'document',
    documentType: 'GENERAL_APPROVAL',
    status: 'draft',
    schemaVersion: 2,
    title: '첨부 테스트 제목',
    description: '첨부 파일 포함 상세 내용',
    payload: { kind: 'general_approval', body: {} },
    requesterUid,
    requesterName: USERS[requesterUid].name,
    requesterRole: USERS[requesterUid].role,
    createdAt: sv.serverTimestamp(),
    submittedAt: null,
    updatedAt: sv.serverTimestamp(),
    reviewerUid: null,
    reviewerName: null,
    reviewedAt: null,
    reviewComment: null,
    rejectionReason: null,
    holdReason: null,
    approvedAt: null,
    appliedAt: null,
    appliedByUid: null,
    lastTransitionId: null,
    attachments: attMap,
    attachmentCount: Object.keys(attMap).length,
    attachmentsTotalSize: totalSize,
    ...overrides
  };
}

// n개의 첨부 엔트리 맵 생성 (각 size 지정)
export function attachmentMap(requesterUid, requestId, sizes) {
  const map = {};
  sizes.forEach((size, index) => {
    const slot = `a${index}`;
    map[slot] = attachmentEntry(requesterUid, requestId, slot, { size });
  });
  return map;
}

// A valid schemaVersion-1 pending (no-attachment) request payload.
export function pendingV1Request(sv, requesterUid) {
  return {
    requestType: 'document',
    documentType: 'GENERAL_APPROVAL',
    status: 'pending',
    schemaVersion: 1,
    title: '일반 결재 제목',
    description: '일반 결재 상세 내용',
    payload: { kind: 'general_approval', body: {} },
    requesterUid,
    requesterName: USERS[requesterUid].name,
    requesterRole: USERS[requesterUid].role,
    createdAt: sv.serverTimestamp(),
    submittedAt: sv.serverTimestamp(),
    updatedAt: sv.serverTimestamp(),
    reviewerUid: null,
    reviewerName: null,
    reviewedAt: null,
    reviewComment: null,
    rejectionReason: null,
    holdReason: null,
    approvedAt: null,
    appliedAt: null,
    appliedByUid: null,
    lastTransitionId: null
  };
}

// Seed a request document directly (rules disabled), converting server
// timestamps to concrete Timestamps so it represents an already-stored doc.
export async function seedRequest(env, requestId, data) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = await import('firebase/firestore');
    const db = ctx.firestore();
    const concrete = { ...data };
    for (const [k, v] of Object.entries(concrete)) {
      if (v && typeof v === 'object' && v._methodName === 'serverTimestamp') {
        concrete[k] = fs.Timestamp.now();
      }
    }
    await fs.setDoc(fs.doc(db, 'document_approval_requests', requestId), concrete);
  });
}

export const HISTORY_ID = 'hist00000000000000001'; // 21 chars (>=16, <=128)
