import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import * as fs from 'firebase/firestore';
import {
  makeFirestoreEnv, seedUsers, seedRequest,
  draftRequest, pendingV1Request, attachmentEntry, attachmentMap, HISTORY_ID
} from './helpers.mjs';

let env;

before(async () => {
  env = await makeFirestoreEnv();
});
after(async () => {
  if (env) await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seedUsers(env);
});

function reqRef(ctx, id) {
  return fs.doc(ctx.firestore(), 'document_approval_requests', id);
}
function histRef(ctx, id, hid) {
  return fs.doc(ctx.firestore(), 'document_approval_requests', id, 'history', hid);
}

describe('document_approval_requests create', () => {
  test('비로그인 사용자는 draft 생성 불가', async () => {
    const ctx = env.unauthenticatedContext();
    await assertFails(fs.setDoc(reqRef(ctx, 'r1'), draftRequest(fs, 'emp1', 'r1')));
  });

  test('inactive 사용자는 draft 생성 불가', async () => {
    const ctx = env.authenticatedContext('inactive1');
    await assertFails(fs.setDoc(reqRef(ctx, 'r1'), draftRequest(fs, 'inactive1', 'r1')));
  });

  test('requesterUid != auth.uid 인 draft 생성 불가', async () => {
    const ctx = env.authenticatedContext('emp1');
    // emp1 이 emp2 소유 요청을 만들려는 시도
    await assertFails(fs.setDoc(reqRef(ctx, 'r1'), draftRequest(fs, 'emp2', 'r1')));
  });

  test('active 직원 본인 draft(v2, 유효 첨부) 생성 허용', async () => {
    const ctx = env.authenticatedContext('emp1');
    await assertSucceeds(fs.setDoc(reqRef(ctx, 'r1'), draftRequest(fs, 'emp1', 'r1')));
  });

  test('기존 v1 pending(첨부 없음) 생성 허용 — 하위호환', async () => {
    const ctx = env.authenticatedContext('emp1');
    await assertSucceeds(fs.setDoc(reqRef(ctx, 'r1'), pendingV1Request(fs, 'emp1')));
  });

  test('v1 create 에 attachments 키가 있으면 차단', async () => {
    const ctx = env.authenticatedContext('emp1');
    const bad = { ...pendingV1Request(fs, 'emp1'), attachments: { a0: attachmentEntry('emp1', 'r1', 'a0') }, attachmentCount: 1, attachmentsTotalSize: 2048 };
    await assertFails(fs.setDoc(reqRef(ctx, 'r1'), bad));
  });

  test('잘못된 storagePath 첨부는 차단', async () => {
    const ctx = env.authenticatedContext('emp1');
    const att = { a0: attachmentEntry('emp1', 'r1', 'a0', { storagePath: 'document-approval-attachments/emp2/r1/a0' }) };
    await assertFails(fs.setDoc(reqRef(ctx, 'r1'), draftRequest(fs, 'emp1', 'r1', att)));
  });

  // 참고: contentType allow-list(확장자↔MIME) 강제는 storage.rules 에서 수행한다.
  // (storage.test.mjs "허용되지 않은 contentType 은 업로드 불가" 참고)
  // Firestore 규칙은 구조/타입만 검증한다.
  test('첨부 항목 contentType 이 문자열이 아니면 차단', async () => {
    const ctx = env.authenticatedContext('emp1');
    const att = { a0: attachmentEntry('emp1', 'r1', 'a0', { contentType: 12345 }) };
    await assertFails(fs.setDoc(reqRef(ctx, 'r1'), draftRequest(fs, 'emp1', 'r1', att)));
  });

  test('첨부 항목에 허용되지 않은 키가 있으면 차단', async () => {
    const ctx = env.authenticatedContext('emp1');
    const att = { a0: { ...attachmentEntry('emp1', 'r1', 'a0'), extra: 'x' } };
    await assertFails(fs.setDoc(reqRef(ctx, 'r1'), draftRequest(fs, 'emp1', 'r1', att)));
  });

  test('첨부 6개 초과는 차단', async () => {
    const ctx = env.authenticatedContext('emp1');
    const att = {};
    for (const s of ['a0', 'a1', 'a2', 'a3', 'a4', 'a5']) att[s] = attachmentEntry('emp1', 'r1', s);
    await assertFails(fs.setDoc(reqRef(ctx, 'r1'), draftRequest(fs, 'emp1', 'r1', att)));
  });

  test('개별 첨부 10MB 초과는 차단', async () => {
    const ctx = env.authenticatedContext('emp1');
    const att = { a0: attachmentEntry('emp1', 'r1', 'a0', { size: 10 * 1024 * 1024 + 1 }) };
    await assertFails(fs.setDoc(reqRef(ctx, 'r1'), draftRequest(fs, 'emp1', 'r1', att)));
  });

  test('총 30MB 초과 메타데이터는 차단', async () => {
    const ctx = env.authenticatedContext('emp1');
    const att = {
      a0: attachmentEntry('emp1', 'r1', 'a0', { size: 9 * 1024 * 1024 }),
      a1: attachmentEntry('emp1', 'r1', 'a1', { size: 9 * 1024 * 1024 }),
      a2: attachmentEntry('emp1', 'r1', 'a2', { size: 9 * 1024 * 1024 }),
      a3: attachmentEntry('emp1', 'r1', 'a3', { size: 9 * 1024 * 1024 })
    };
    // count=4 (ok) but total 36MB > 30MB → 차단
    await assertFails(fs.setDoc(reqRef(ctx, 'r1'), draftRequest(fs, 'emp1', 'r1', att)));
  });

  test('attachmentCount 와 실제 키 수 불일치는 차단', async () => {
    const ctx = env.authenticatedContext('emp1');
    const base = draftRequest(fs, 'emp1', 'r1');
    base.attachmentCount = 3; // 실제 1개
    await assertFails(fs.setDoc(reqRef(ctx, 'r1'), base));
  });

  // ── WORK29-CORRECTION D1: attachmentsTotalSize 우회 차단 ──────────────
  test('D1: 첨부 1개 + 합계 정확 → 허용', async () => {
    const ctx = env.authenticatedContext('emp1');
    const att = attachmentMap('emp1', 'r1', [4096]);
    await assertSucceeds(fs.setDoc(reqRef(ctx, 'r1'), draftRequest(fs, 'emp1', 'r1', att)));
  });

  test('D1: 첨부 5개 + 합계 정확히 30MB → 허용', async () => {
    const ctx = env.authenticatedContext('emp1');
    const each = 6 * 1024 * 1024; // 5 × 6MB = 30MB (파일당 10MB 이하)
    const att = attachmentMap('emp1', 'r1', [each, each, each, each, each]);
    const payload = draftRequest(fs, 'emp1', 'r1', att);
    assert.equal(payload.attachmentsTotalSize, 31457280);
    await assertSucceeds(fs.setDoc(reqRef(ctx, 'r1'), payload));
  });

  test('D1: 실제 합계가 30MB를 초과하면 차단 (정직한 합계여도)', async () => {
    const ctx = env.authenticatedContext('emp1');
    const each = 6 * 1024 * 1024 + 1; // 5 × (6MB+1) > 30MB
    const att = attachmentMap('emp1', 'r1', [each, each, each, each, each]);
    await assertFails(fs.setDoc(reqRef(ctx, 'r1'), draftRequest(fs, 'emp1', 'r1', att)));
  });

  test('D1: attachmentsTotalSize 를 실제보다 작게 조작하면 차단 (30MB 우회 시도)', async () => {
    const ctx = env.authenticatedContext('emp1');
    const each = 10 * 1024 * 1024; // 5 × 10MB = 50MB 실제
    const att = attachmentMap('emp1', 'r1', [each, each, each, each, each]);
    // 합계를 1바이트로 위장 → 실제 합계 검증에서 차단돼야 한다
    await assertFails(fs.setDoc(reqRef(ctx, 'r1'), draftRequest(fs, 'emp1', 'r1', att, { attachmentsTotalSize: 1 })));
  });

  test('D1: attachmentsTotalSize 를 실제보다 크게 조작해도 차단', async () => {
    const ctx = env.authenticatedContext('emp1');
    const att = attachmentMap('emp1', 'r1', [2048]);
    await assertFails(fs.setDoc(reqRef(ctx, 'r1'), draftRequest(fs, 'emp1', 'r1', att, { attachmentsTotalSize: 4096 })));
  });

  test('D1: 첨부 이름이 빈 문자열이면 차단', async () => {
    const ctx = env.authenticatedContext('emp1');
    const att = { a0: attachmentEntry('emp1', 'r1', 'a0', { name: '' }) };
    await assertFails(fs.setDoc(reqRef(ctx, 'r1'), draftRequest(fs, 'emp1', 'r1', att)));
  });

  test('D1: 첨부 contentType 이 빈 문자열이면 차단', async () => {
    const ctx = env.authenticatedContext('emp1');
    const att = { a0: attachmentEntry('emp1', 'r1', 'a0', { contentType: '' }) };
    await assertFails(fs.setDoc(reqRef(ctx, 'r1'), draftRequest(fs, 'emp1', 'r1', att)));
  });
});

describe('document_approval_requests read', () => {
  beforeEach(async () => {
    await seedRequest(env, 'r1', draftRequest(fs, 'emp1', 'r1'));
  });

  test('본인은 자신의 요청 조회 가능', async () => {
    const ctx = env.authenticatedContext('emp1');
    await assertSucceeds(fs.getDoc(reqRef(ctx, 'r1')));
  });

  test('다른 직원은 타인 요청 조회 불가', async () => {
    const ctx = env.authenticatedContext('emp2');
    await assertFails(fs.getDoc(reqRef(ctx, 'r1')));
  });

  test('admin 은 모든 요청 조회 가능', async () => {
    const ctx = env.authenticatedContext('admin1');
    await assertSucceeds(fs.getDoc(reqRef(ctx, 'r1')));
  });
});

describe('draft → pending 제출 (요청자 트랜잭션)', () => {
  beforeEach(async () => {
    await seedRequest(env, 'r1', draftRequest(fs, 'emp1', 'r1'));
  });

  // 첨부 5개(최대치) 문서에서도 update 경로가 1000-expression 한도 안에서 평가되는지 확인.
  test('D1: 첨부 5개 요청도 draft→pending 전이 허용 (update 경로 한도 회귀)', async () => {
    const each = 6 * 1024 * 1024;
    const att = attachmentMap('emp1', 'r5', [each, each, each, each, each]);
    await seedRequest(env, 'r5', draftRequest(fs, 'emp1', 'r5', att));
    const ctx = env.authenticatedContext('emp1');
    const batch = fs.writeBatch(ctx.firestore());
    batch.update(reqRef(ctx, 'r5'), {
      status: 'pending',
      submittedAt: fs.serverTimestamp(),
      updatedAt: fs.serverTimestamp(),
      lastTransitionId: HISTORY_ID
    });
    batch.set(histRef(ctx, 'r5', HISTORY_ID), {
      requestId: 'r5', transitionId: HISTORY_ID, action: 'submitted',
      previousStatus: 'draft', nextStatus: 'pending',
      actorUid: 'emp1', actorName: '홍길동', actorRole: 'sales',
      comment: '', createdAt: fs.serverTimestamp(), schemaVersion: 1
    });
    await assertSucceeds(batch.commit());
  });

  test('요청자는 draft→pending 전이 + submitted history 생성 허용', async () => {
    const ctx = env.authenticatedContext('emp1');
    const batch = fs.writeBatch(ctx.firestore());
    batch.update(reqRef(ctx, 'r1'), {
      status: 'pending',
      submittedAt: fs.serverTimestamp(),
      updatedAt: fs.serverTimestamp(),
      lastTransitionId: HISTORY_ID
    });
    batch.set(histRef(ctx, 'r1', HISTORY_ID), {
      requestId: 'r1', transitionId: HISTORY_ID, action: 'submitted',
      previousStatus: 'draft', nextStatus: 'pending',
      actorUid: 'emp1', actorName: '홍길동', actorRole: 'sales',
      comment: '', createdAt: fs.serverTimestamp(), schemaVersion: 1
    });
    await assertSucceeds(batch.commit());
  });

  test('요청자가 draft→pending 시 attachments 변조하면 차단', async () => {
    const ctx = env.authenticatedContext('emp1');
    const batch = fs.writeBatch(ctx.firestore());
    batch.update(reqRef(ctx, 'r1'), {
      status: 'pending',
      submittedAt: fs.serverTimestamp(),
      updatedAt: fs.serverTimestamp(),
      lastTransitionId: HISTORY_ID,
      attachments: { a0: attachmentEntry('emp1', 'r1', 'a0', { size: 5000 }) }
    });
    batch.set(histRef(ctx, 'r1', HISTORY_ID), {
      requestId: 'r1', transitionId: HISTORY_ID, action: 'submitted',
      previousStatus: 'draft', nextStatus: 'pending',
      actorUid: 'emp1', actorName: '홍길동', actorRole: 'sales',
      comment: '', createdAt: fs.serverTimestamp(), schemaVersion: 1
    });
    await assertFails(batch.commit());
  });

  test('history 없는 상태 전이는 차단', async () => {
    const ctx = env.authenticatedContext('emp1');
    await assertFails(fs.updateDoc(reqRef(ctx, 'r1'), {
      status: 'pending',
      submittedAt: fs.serverTimestamp(),
      updatedAt: fs.serverTimestamp(),
      lastTransitionId: HISTORY_ID
    }));
  });
});

describe('admin 결재 처리', () => {
  beforeEach(async () => {
    // 첨부 포함 pending 요청 (draft 에서 제출된 상태를 시뮬레이션)
    // 첨부 5개(최대치)로 seed 해 admin update 경로의 1000-expression 한도까지 함께 검증한다.
    const each = 6 * 1024 * 1024;
    const att = attachmentMap('emp1', 'r1', [each, each, each, each, each]);
    const pending = draftRequest(fs, 'emp1', 'r1', att);
    pending.status = 'pending';
    pending.submittedAt = fs.serverTimestamp();
    pending.lastTransitionId = 'seed0000000000000001';
    await seedRequest(env, 'r1', pending);
  });

  function approveBatch(ctx, overrides = {}) {
    const batch = fs.writeBatch(ctx.firestore());
    batch.update(reqRef(ctx, 'r1'), {
      status: 'approved',
      reviewerUid: overrides.reviewerUid || 'admin1',
      reviewerName: overrides.reviewerName || '관리자',
      reviewedAt: fs.serverTimestamp(),
      updatedAt: fs.serverTimestamp(),
      approvedAt: fs.serverTimestamp(),
      lastTransitionId: HISTORY_ID,
      ...(overrides.reqExtra || {})
    });
    batch.set(histRef(ctx, 'r1', HISTORY_ID), {
      requestId: 'r1', transitionId: HISTORY_ID, action: 'approved',
      previousStatus: 'pending', nextStatus: 'approved',
      actorUid: overrides.actorUid || 'admin1', actorName: '관리자', actorRole: 'admin',
      comment: '', createdAt: fs.serverTimestamp(), schemaVersion: 1,
      ...(overrides.histExtra || {})
    });
    return batch;
  }

  test('active admin 은 승인 처리 + history 허용 (첨부 보존)', async () => {
    const ctx = env.authenticatedContext('admin1');
    await assertSucceeds(approveBatch(ctx).commit());
  });

  test('일반 직원은 관리자 결재 처리 불가', async () => {
    const ctx = env.authenticatedContext('emp1');
    await assertFails(approveBatch(ctx, { actorUid: 'emp1' }).commit());
  });

  test('제출 후 admin 이 attachments 변조 시 차단', async () => {
    const ctx = env.authenticatedContext('admin1');
    const batch = approveBatch(ctx, {
      reqExtra: { attachments: { a0: attachmentEntry('emp1', 'r1', 'a0', { size: 1 }) } }
    });
    await assertFails(batch.commit());
  });

  test('parent 상태와 history nextStatus 불일치 시 차단', async () => {
    const ctx = env.authenticatedContext('admin1');
    const batch = approveBatch(ctx, { histExtra: { nextStatus: 'rejected', action: 'rejected' } });
    await assertFails(batch.commit());
  });
});

describe('삭제 규칙', () => {
  test('요청자는 본인 draft 삭제 가능 (rollback)', async () => {
    await seedRequest(env, 'r1', draftRequest(fs, 'emp1', 'r1'));
    const ctx = env.authenticatedContext('emp1');
    await assertSucceeds(fs.deleteDoc(reqRef(ctx, 'r1')));
  });

  test('pending 요청은 삭제 불가', async () => {
    const pending = draftRequest(fs, 'emp1', 'r1');
    pending.status = 'pending';
    await seedRequest(env, 'r1', pending);
    const ctx = env.authenticatedContext('emp1');
    await assertFails(fs.deleteDoc(reqRef(ctx, 'r1')));
  });

  test('타인 draft 는 삭제 불가', async () => {
    await seedRequest(env, 'r1', draftRequest(fs, 'emp1', 'r1'));
    const ctx = env.authenticatedContext('emp2');
    await assertFails(fs.deleteDoc(reqRef(ctx, 'r1')));
  });
});
