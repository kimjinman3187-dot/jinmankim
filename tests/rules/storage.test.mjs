import { test, before, after, beforeEach, describe } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import * as fss from 'firebase/storage';
import * as fs from 'firebase/firestore';
import { makeStorageEnv, seedUsers, seedRequest, draftRequest } from './helpers.mjs';

let env;
const PATH = 'document-approval-attachments/emp1/r1/a0';
const PDF = { contentType: 'application/pdf' };
const SMALL = new Uint8Array([1, 2, 3, 4]);

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

async function seedDraft(status = 'draft') {
  const req = draftRequest(fs, 'emp1', 'r1');
  req.status = status;
  await seedRequest(env, 'r1', req);
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
