import { test, before, after, beforeEach, describe } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import * as fss from 'firebase/storage';
import * as fs from 'firebase/firestore';
import { makeStorageEnv, seedUsers, seedRequest, draftRequest, attachmentEntry } from './helpers.mjs';

let env;
const PATH = 'document-approval-attachments/emp1/r1/a0';
const PDF = { contentType: 'application/pdf' };
const SMALL = new Uint8Array([1, 2, 3, 4]);
// WORK29-CORRECTION D2: Storage 객체는 Firestore 첨부 메타(size/contentType/경로)와 결속된다.
// 따라서 seed 하는 draft 메타는 실제 업로드 객체와 동일한 값이어야 허용된다.
const SMALL_META = { size: SMALL.length, contentType: 'application/pdf' };

before(async () => {
  env = await makeStorageEnv();
});
after(async () => {
  if (env) await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await seedUsers(env);
});

// 기본 seed: r1(emp1) draft + a0 슬롯이 실제 업로드 객체와 동일한 메타로 등록된 상태
async function seedDraft(status = 'draft', attachments) {
  const att = attachments || { a0: attachmentEntry('emp1', 'r1', 'a0', SMALL_META) };
  const req = draftRequest(fs, 'emp1', 'r1', att);
  req.status = status;
  await seedRequest(env, 'r1', req);
}

// D2 전용: 테스트마다 고유 requestId 를 사용해 이전 테스트의 Storage 객체 잔존
// (emulator clearStorage 의존)에 영향받지 않도록 격리한다.
async function seedDraftFor(requestId, attachmentOverrides = {}, uid = 'emp1') {
  const att = { a0: attachmentEntry(uid, requestId, 'a0', { ...SMALL_META, ...attachmentOverrides }) };
  await seedRequest(env, requestId, draftRequest(fs, uid, requestId, att));
  return `document-approval-attachments/${uid}/${requestId}/a0`;
}

async function seedObject() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await fss.uploadBytes(fss.ref(ctx.storage(), PATH), SMALL, PDF);
  });
}

function upload(ctx, path, data, meta) {
  return fss.uploadBytes(fss.ref(ctx.storage(), path), data, meta);
}
function read(ctx, path) {
  return fss.getBytes(fss.ref(ctx.storage(), path));
}

describe('Storage 업로드 (write)', () => {
  test('비로그인 사용자는 업로드 불가', async () => {
    await seedDraft();
    const ctx = env.unauthenticatedContext();
    await assertFails(upload(ctx, PATH, SMALL, PDF));
  });

  test('요청자 본인은 자신의 draft 경로에 업로드 허용', async () => {
    await seedDraft();
    const ctx = env.authenticatedContext('emp1');
    await assertSucceeds(upload(ctx, PATH, SMALL, PDF));
  });

  test('타 직원 경로에는 업로드 불가', async () => {
    await seedDraft();
    const ctx = env.authenticatedContext('emp2');
    await assertFails(upload(ctx, PATH, SMALL, PDF));
  });

  test('inactive 사용자는 업로드 불가', async () => {
    await seedDraft();
    const ctx = env.authenticatedContext('inactive1');
    await assertFails(upload(ctx, 'document-approval-attachments/inactive1/r1/a0', SMALL, PDF));
  });

  test('허용되지 않은 contentType 은 업로드 불가', async () => {
    await seedDraft();
    const ctx = env.authenticatedContext('emp1');
    await assertFails(upload(ctx, PATH, SMALL, { contentType: 'application/zip' }));
  });

  test('파일당 10MB 초과는 업로드 불가', async () => {
    await seedDraft();
    const ctx = env.authenticatedContext('emp1');
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    await assertFails(upload(ctx, PATH, big, PDF));
  });

  test('잘못된 slot 이름은 업로드 불가', async () => {
    await seedDraft();
    const ctx = env.authenticatedContext('emp1');
    await assertFails(upload(ctx, 'document-approval-attachments/emp1/r1/a9', SMALL, PDF));
  });

  test('기존 객체 덮어쓰기 불가', async () => {
    await seedDraft();
    await seedObject();
    const ctx = env.authenticatedContext('emp1');
    await assertFails(upload(ctx, PATH, SMALL, PDF));
  });

  test('pending 이후에는 업로드(생성) 불가', async () => {
    await seedDraft('pending');
    const ctx = env.authenticatedContext('emp1');
    await assertFails(upload(ctx, PATH, SMALL, PDF));
  });

  test('임의 경로 접근 불가', async () => {
    await seedDraft();
    const ctx = env.authenticatedContext('emp1');
    await assertFails(upload(ctx, 'random/path/x', SMALL, PDF));
  });
});

// ── WORK29-CORRECTION D2: Firestore 첨부 메타 ↔ Storage 객체 결속 ──────────
describe('Storage ↔ Firestore 첨부 메타 결속 (D2)', () => {
  test('D2: 등록된 슬롯·경로·크기·contentType 이 모두 일치하면 허용', async () => {
    const path = await seedDraftFor('d2ok');
    const ctx = env.authenticatedContext('emp1');
    await assertSucceeds(upload(ctx, path, SMALL, PDF));
  });

  test('D2: Firestore 에 등록되지 않은 추가 슬롯 업로드 차단', async () => {
    await seedDraftFor('d2slot'); // a0 만 등록
    const ctx = env.authenticatedContext('emp1');
    await assertFails(upload(ctx, 'document-approval-attachments/emp1/d2slot/a1', SMALL, PDF));
  });

  test('D2: 등록 메타의 storagePath 가 실제 업로드 경로와 다르면 차단', async () => {
    const path = await seedDraftFor('d2path', {
      storagePath: 'document-approval-attachments/emp1/d2path/a1' // 슬롯 경로 불일치
    });
    const ctx = env.authenticatedContext('emp1');
    await assertFails(upload(ctx, path, SMALL, PDF));
  });

  test('D2: 등록 메타의 contentType 과 업로드 contentType 이 다르면 차단', async () => {
    const path = await seedDraftFor('d2ct', { contentType: 'image/png' });
    const ctx = env.authenticatedContext('emp1');
    await assertFails(upload(ctx, path, SMALL, PDF));
  });

  test('D2: 등록 메타의 size 와 실제 객체 크기가 다르면 차단 (과소 신고)', async () => {
    const path = await seedDraftFor('d2small', { size: 1 });
    const ctx = env.authenticatedContext('emp1');
    await assertFails(upload(ctx, path, SMALL, PDF));
  });

  test('D2: 등록 메타의 size 보다 큰 객체 업로드 차단', async () => {
    const path = await seedDraftFor('d2big', { size: 4 });
    const ctx = env.authenticatedContext('emp1');
    await assertFails(upload(ctx, path, new Uint8Array(1024), PDF));
  });

  test('D2: 존재하지 않는 다른 requestId 경로 업로드 차단', async () => {
    await seedDraftFor('d2exist');
    const ctx = env.authenticatedContext('emp1');
    await assertFails(upload(ctx, 'document-approval-attachments/emp1/nosuch/a0', SMALL, PDF));
  });

  test('D2: 타 직원 소유 요청의 requestId 를 자신의 경로에 사용해도 차단', async () => {
    await seedDraftFor('d2other', {}, 'emp2'); // emp2 소유 draft
    const ctx = env.authenticatedContext('emp1');
    await assertFails(upload(ctx, 'document-approval-attachments/emp1/d2other/a0', SMALL, PDF));
  });
});

describe('Storage 읽기 (read)', () => {
  beforeEach(async () => {
    await seedDraft();
    await seedObject();
  });

  test('요청자 본인은 자신의 첨부 읽기 허용', async () => {
    const ctx = env.authenticatedContext('emp1');
    await assertSucceeds(read(ctx, PATH));
  });

  test('타 직원은 첨부 읽기 불가', async () => {
    const ctx = env.authenticatedContext('emp2');
    await assertFails(read(ctx, PATH));
  });

  test('active admin 은 첨부 읽기 허용', async () => {
    const ctx = env.authenticatedContext('admin1');
    await assertSucceeds(read(ctx, PATH));
  });

  test('비로그인 사용자는 첨부 읽기 불가', async () => {
    const ctx = env.unauthenticatedContext();
    await assertFails(read(ctx, PATH));
  });
});

describe('Storage 삭제 (delete)', () => {
  test('요청자는 draft 단계 첨부 삭제 허용 (rollback 정리)', async () => {
    await seedDraft('draft');
    await seedObject();
    const ctx = env.authenticatedContext('emp1');
    await assertSucceeds(fss.deleteObject(fss.ref(ctx.storage(), PATH)));
  });

  test('pending 이후에는 요청자도 첨부 삭제 불가 (불변 보장)', async () => {
    await seedDraft('pending');
    await seedObject();
    const ctx = env.authenticatedContext('emp1');
    await assertFails(fss.deleteObject(fss.ref(ctx.storage(), PATH)));
  });

  test('타 직원은 draft 단계라도 첨부 삭제 불가', async () => {
    await seedDraft('draft');
    await seedObject();
    const ctx = env.authenticatedContext('emp2');
    await assertFails(fss.deleteObject(fss.ref(ctx.storage(), PATH)));
  });
});
