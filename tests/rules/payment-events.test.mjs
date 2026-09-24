// WORK52-2 Rules 단위 테스트: 입금 이벤트 원장(paymentEvents) + 주문 입금필드 보호
// 실행: tests/rules 에서 `npm test`(firebase emulators:exec ... "node --test")
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { makeFirestoreEnv, seedUsers } from './helpers.mjs';

let env;
const ORDER_ID = 'ORDER_PAY_1';

function fs() { return import('firebase/firestore'); }

function paymentEventPayload(actorUid, actorRole, overrides = {}) {
  return {
    eventId: 'ev1', operationId: 'op-1', type: 'payment', amount: 1000,
    paymentDate: '2026-09-22', paymentMethod: 'bank_transfer', senderName: '거래처',
    reference: '', memo: '', targetEventId: '', reason: '',
    actorUid, actorName: '이름', actorRole,
    createdAt: Date.now(), beforePaidAmount: 0, afterPaidAmount: 1000,
    ...overrides
  };
}

before(async () => {
  env = await makeFirestoreEnv();
  await seedUsers(env);
});
after(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const { doc, setDoc, getDocs, collection, deleteDoc } = await fs();
    const db = ctx.firestore();
    // 이전 이벤트 정리
    const evs = await getDocs(collection(db, 'orders', ORDER_ID, 'paymentEvents'));
    for (const d of evs.docs) await deleteDoc(d.ref);
    await setDoc(doc(db, 'orders', ORDER_ID), { client: '거래처', price: 1000, qty: 10, status: 'completed', paymentStatus: 'unpaid', paidAmount: 0 });
  });
});

test('회계 직원은 입금 이벤트를 생성할 수 있다', async () => {
  const { doc, setDoc } = await fs();
  const db = env.authenticatedContext('emp2').firestore(); // accounting
  await assertSucceeds(setDoc(doc(db, 'orders', ORDER_ID, 'paymentEvents', 'ev1'), paymentEventPayload('emp2', 'accounting')));
});
test('관리자는 입금 이벤트를 생성할 수 있다', async () => {
  const { doc, setDoc } = await fs();
  const db = env.authenticatedContext('admin1').firestore();
  await assertSucceeds(setDoc(doc(db, 'orders', ORDER_ID, 'paymentEvents', 'ev1'), paymentEventPayload('admin1', 'admin')));
});
test('영업 직원은 입금 이벤트를 생성할 수 없다', async () => {
  const { doc, setDoc } = await fs();
  const db = env.authenticatedContext('emp1').firestore(); // sales
  await assertFails(setDoc(doc(db, 'orders', ORDER_ID, 'paymentEvents', 'ev1'), paymentEventPayload('emp1', 'sales')));
});
test('actorRole/actorUid가 조작되면 거부된다', async () => {
  const { doc, setDoc } = await fs();
  const db = env.authenticatedContext('emp2').firestore(); // accounting
  await assertFails(setDoc(doc(db, 'orders', ORDER_ID, 'paymentEvents', 'ev1'), paymentEventPayload('emp2', 'sales'))); // role 위조
  await assertFails(setDoc(doc(db, 'orders', ORDER_ID, 'paymentEvents', 'ev1'), paymentEventPayload('other', 'accounting'))); // uid 위조
  await assertFails(setDoc(doc(db, 'orders', ORDER_ID, 'paymentEvents', 'ev1'), paymentEventPayload('emp2', 'accounting', { operationId: '' }))); // operationId 누락
});
test('입금 이벤트는 수정·삭제할 수 없다(불변)', async () => {
  const { doc, setDoc, updateDoc, deleteDoc } = await fs();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const { doc: d, setDoc: s } = await fs();
    await s(d(ctx.firestore(), 'orders', ORDER_ID, 'paymentEvents', 'ev1'), paymentEventPayload('emp2', 'accounting'));
  });
  const db = env.authenticatedContext('admin1').firestore();
  await assertFails(updateDoc(doc(db, 'orders', ORDER_ID, 'paymentEvents', 'ev1'), { amount: 9999 }));
  await assertFails(deleteDoc(doc(db, 'orders', ORDER_ID, 'paymentEvents', 'ev1')));
});
test('주문 입금필드 변경은 회계·관리자만 + 같은 커밋에 입금 이벤트 바인딩 필수', async () => {
  const { doc, updateDoc, writeBatch } = await fs();
  const acc = env.authenticatedContext('emp2').firestore();
  // 이벤트를 함께 생성하는 배치 = 허용
  const batch = writeBatch(acc);
  batch.set(doc(acc, 'orders', ORDER_ID, 'paymentEvents', 'op-777'),
    paymentEventPayload('emp2', 'accounting', { operationId: 'op-777', eventId: 'op-777' }));
  batch.update(doc(acc, 'orders', ORDER_ID), { paidAmount: 1000, paymentStatus: 'partial', lastOperationId: 'op-777' });
  await assertSucceeds(batch.commit());
  // 영업은 입금필드 변경 불가
  const sales = env.authenticatedContext('emp1').firestore();
  await assertFails(updateDoc(doc(sales, 'orders', ORDER_ID), { paidAmount: 2000, paymentStatus: 'partial', lastOperationId: 'x' }));
});
test('요약 금액만 바꾸고 이벤트를 누락하면 거부(이벤트 바인딩)', async () => {
  const { doc, updateDoc } = await fs();
  const acc = env.authenticatedContext('emp2').firestore();
  // lastOperationId 자체가 없음 → 거부
  await assertFails(updateDoc(doc(acc, 'orders', ORDER_ID), { paidAmount: 1000, paymentStatus: 'partial' }));
  // lastOperationId는 있으나 해당 이벤트 문서가 없음 → 거부
  await assertFails(updateDoc(doc(acc, 'orders', ORDER_ID), { paidAmount: 1000, paymentStatus: 'partial', lastOperationId: 'ghost' }));
});
test('입금 이벤트 금액 부호·필수필드 검증(유형별)', async () => {
  const { doc, setDoc } = await fs();
  const acc = env.authenticatedContext('emp2').firestore();
  // payment: 0/음수 금액 거부
  await assertFails(setDoc(doc(acc, 'orders', ORDER_ID, 'paymentEvents', 'p0'), paymentEventPayload('emp2', 'accounting', { operationId: 'p0', eventId: 'p0', amount: 0 })));
  await assertFails(setDoc(doc(acc, 'orders', ORDER_ID, 'paymentEvents', 'pneg'), paymentEventPayload('emp2', 'accounting', { operationId: 'pneg', eventId: 'pneg', amount: -5 })));
  // reversal: 음수 + reason + targetEventId 필수
  await assertSucceeds(setDoc(doc(acc, 'orders', ORDER_ID, 'paymentEvents', 'r1'), paymentEventPayload('emp2', 'accounting', { operationId: 'r1', eventId: 'r1', type: 'reversal', amount: -1000, reason: '오입금', targetEventId: 'ev1' })));
  await assertFails(setDoc(doc(acc, 'orders', ORDER_ID, 'paymentEvents', 'r2'), paymentEventPayload('emp2', 'accounting', { operationId: 'r2', eventId: 'r2', type: 'reversal', amount: 1000, reason: '오입금', targetEventId: 'ev1' }))); // 양수 부호 오류
  await assertFails(setDoc(doc(acc, 'orders', ORDER_ID, 'paymentEvents', 'r3'), paymentEventPayload('emp2', 'accounting', { operationId: 'r3', eventId: 'r3', type: 'reversal', amount: -1000, reason: '', targetEventId: 'ev1' }))); // 사유 누락
  await assertFails(setDoc(doc(acc, 'orders', ORDER_ID, 'paymentEvents', 'r4'), paymentEventPayload('emp2', 'accounting', { operationId: 'r4', eventId: 'r4', type: 'reversal', amount: -1000, reason: '오입금', targetEventId: '' }))); // 대상 누락
  // corrected_payment: 양수 + reason + targetEventId 필수
  await assertSucceeds(setDoc(doc(acc, 'orders', ORDER_ID, 'paymentEvents', 'c1'), paymentEventPayload('emp2', 'accounting', { operationId: 'c1', eventId: 'c1', type: 'corrected_payment', amount: 2000, reason: '정정', targetEventId: 'ev1' })));
  await assertFails(setDoc(doc(acc, 'orders', ORDER_ID, 'paymentEvents', 'c2'), paymentEventPayload('emp2', 'accounting', { operationId: 'c2', eventId: 'c2', type: 'corrected_payment', amount: 2000, reason: '', targetEventId: 'ev1' }))); // 사유 누락
});
test('영업·생산의 비입금 필드 업데이트(생산 단계 등)는 기존대로 허용', async () => {
  const { doc, updateDoc } = await fs();
  const sales = env.authenticatedContext('emp1').firestore();
  await assertSucceeds(updateDoc(doc(sales, 'orders', ORDER_ID), { productionStage: 'packed', updatedAt: Date.now() }));
});
test('입금 이벤트 읽기는 활성 사용자면 가능(영업 포함)', async () => {
  const { doc, setDoc, getDoc } = await fs();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const { doc: d, setDoc: s } = await fs();
    await s(d(ctx.firestore(), 'orders', ORDER_ID, 'paymentEvents', 'ev1'), paymentEventPayload('emp2', 'accounting'));
  });
  const sales = env.authenticatedContext('emp1').firestore();
  await assertSucceeds(getDoc(doc(sales, 'orders', ORDER_ID, 'paymentEvents', 'ev1')));
});
