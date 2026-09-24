// WORK52-2 Rules 무결성 테스트(최종): 역방향 바인딩·서버시각·가격/수량 보호·필드형식 포함.
import { test, before, after, beforeEach } from 'node:test';
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { makeFirestoreEnv, seedUsers } from './helpers.mjs';

let env;
const OID = 'ORDER_PAY_1';
const TOTAL = 10000; // price 1000 * qty 10
function fs() { return import('firebase/firestore'); }
let ST; // serverTimestamp()

function evt(id, o) {
  return {
    eventId: id, operationId: id, type: o.type, amount: o.amount,
    paymentDate: o.paymentDate !== undefined ? o.paymentDate : '2026-09-24',
    paymentMethod: o.paymentMethod !== undefined ? o.paymentMethod : 'bank_transfer',
    senderName: '', reference: '', memo: '',
    targetEventId: o.target || '', reason: o.reason || '',
    actorUid: o.uid || 'emp2', actorName: '회계', actorRole: o.role || 'accounting',
    createdAt: o.createdAt !== undefined ? o.createdAt : ST(),
    beforePaidAmount: o.before, afterPaidAmount: o.after
  };
}
function mk(target, o) {
  return {
    targetEventId: target, operationId: o.op, kind: o.kind,
    actorUid: o.uid || 'emp2', actorRole: o.role || 'accounting',
    createdAt: o.createdAt !== undefined ? o.createdAt : ST()
  };
}
function summary(o) {
  const s = Object.assign({
    paymentLedgerInitialized: true, paymentLedgerOpeningBalance: 0, updatedAt: ST(),
    lastPaymentAt: o.lastPaymentAt !== undefined ? o.lastPaymentAt : ST(),
    paidAt: o.paidAt !== undefined ? o.paidAt : null
  }, o);
  return s;
}

before(async () => { env = await makeFirestoreEnv(); await seedUsers(env); const m = await fs(); ST = m.serverTimestamp; });
after(async () => { await env.cleanup(); });

async function seedOrder(extra = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const m = await fs(); const db = ctx.firestore();
    for (const sub of ['paymentEvents', 'paymentEventActions']) {
      const s = await m.getDocs(m.collection(db, 'orders', OID, sub));
      for (const d of s.docs) await m.deleteDoc(d.ref);
    }
    await m.setDoc(m.doc(db, 'orders', OID), Object.assign({ client: 'c', price: 1000, qty: 10, status: 'completed', paymentStatus: 'unpaid', paidAmount: 0 }, extra));
  });
}
async function seedDocs(docs) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const m = await fs(); const db = ctx.firestore();
    for (const [id, d] of Object.entries(docs.events || {})) await m.setDoc(m.doc(db, 'orders', OID, 'paymentEvents', id), d);
    for (const [id, d] of Object.entries(docs.markers || {})) await m.setDoc(m.doc(db, 'orders', OID, 'paymentEventActions', id), d);
  });
}
function R(db, m) {
  return { order: m.doc(db, 'orders', OID), ev: (id) => m.doc(db, 'orders', OID, 'paymentEvents', id), act: (id) => m.doc(db, 'orders', OID, 'paymentEventActions', id) };
}
beforeEach(async () => { await seedOrder(); });

// 정상 배치 빌더
function payBatch(db, m, { amount = 1000, before = 0, after = 1000, status = 'partial', paidAt } = {}) {
  const r = R(db, m); const b = m.writeBatch(db);
  b.set(r.ev('op1'), evt('op1', { type: 'payment', amount, before, after }));
  b.update(r.order, summary({ paidAmount: after, paymentStatus: status, lastPaymentAmount: amount, firstOperationId: 'op1', lastOperationId: 'op1', paidAt: paidAt !== undefined ? paidAt : (status === 'paid' ? ST() : null) }));
  return b;
}

// ── 정상 원자 배치 ────────────────────────────────────────
test('정상 입금 배치 허용', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore();
  await assertSucceeds(payBatch(db, m).commit());
});
test('정상 완납 배치 허용(paidAt=서버시각)', async () => {
  await seedOrder({ paidAmount: 9000, paymentStatus: 'partial', paymentLedgerInitialized: true, paymentLedgerOpeningBalance: 0 });
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('op2'), evt('op2', { type: 'payment', amount: 1000, before: 9000, after: 10000 }));
  b.update(r.order, summary({ paidAmount: 10000, paymentStatus: 'paid', paidAt: ST(), lastPaymentAmount: 1000, firstOperationId: 'op2', lastOperationId: 'op2' }));
  await assertSucceeds(b.commit());
});
test('정상 취소 배치 허용', async () => {
  await seedOrder({ paidAmount: 1000, paymentStatus: 'partial', paymentLedgerInitialized: true, paymentLedgerOpeningBalance: 0 });
  await seedDocs({ events: { p1: evt('p1', { type: 'payment', amount: 1000, before: 0, after: 1000, createdAt: 1 }) } });
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('r1'), evt('r1', { type: 'reversal', amount: -1000, before: 1000, after: 0, target: 'p1', reason: 'x' }));
  b.set(r.act('p1'), mk('p1', { op: 'r1', kind: 'reversal' }));
  b.update(r.order, summary({ paidAmount: 0, paymentStatus: 'unpaid', lastPaymentAmount: -1000, firstOperationId: 'r1', lastOperationId: 'r1' }));
  await assertSucceeds(b.commit());
});
test('정상 정정 배치 허용', async () => {
  await seedOrder({ paidAmount: 3000, paymentStatus: 'partial', paymentLedgerInitialized: true, paymentLedgerOpeningBalance: 0 });
  await seedDocs({ events: { p1: evt('p1', { type: 'payment', amount: 3000, before: 0, after: 3000, createdAt: 1 }) } });
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('c1'), evt('c1', { type: 'reversal', amount: -3000, before: 3000, after: 0, target: 'p1', reason: 'fix' }));
  b.set(r.ev('c1__c'), evt('c1__c', { type: 'corrected_payment', amount: 5000, before: 0, after: 5000, target: 'p1', reason: 'fix' }));
  b.set(r.act('p1'), mk('p1', { op: 'c1', kind: 'correction' }));
  b.update(r.order, summary({ paidAmount: 5000, paymentStatus: 'partial', lastPaymentAmount: 5000, firstOperationId: 'c1', lastOperationId: 'c1__c' }));
  await assertSucceeds(b.commit());
});

// ── 고아 차단(역방향 바인딩) ──────────────────────────────
test('payment 이벤트만 단독 생성 → 거부', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  await assertFails(m.setDoc(r.ev('op1'), evt('op1', { type: 'payment', amount: 1000, before: 0, after: 1000 })));
});
test('reversal+마커만 생성하고 주문 요약 누락 → 거부', async () => {
  await seedDocs({ events: { p1: evt('p1', { type: 'payment', amount: 1000, before: 0, after: 1000, createdAt: 1 }) } });
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('r1'), evt('r1', { type: 'reversal', amount: -1000, before: 1000, after: 0, target: 'p1', reason: 'x' }));
  b.set(r.act('p1'), mk('p1', { op: 'r1', kind: 'reversal' }));
  await assertFails(b.commit()); // 주문 update 없음
});
test('correction 두 이벤트+마커만 생성하고 요약 누락 → 거부', async () => {
  await seedDocs({ events: { p1: evt('p1', { type: 'payment', amount: 3000, before: 0, after: 3000, createdAt: 1 }) } });
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('c1'), evt('c1', { type: 'reversal', amount: -3000, before: 3000, after: 0, target: 'p1', reason: 'f' }));
  b.set(r.ev('c1__c'), evt('c1__c', { type: 'corrected_payment', amount: 5000, before: 0, after: 5000, target: 'p1', reason: 'f' }));
  b.set(r.act('p1'), mk('p1', { op: 'c1', kind: 'correction' }));
  await assertFails(b.commit());
});
test('기존 reversal을 이용해 마커만 단독 생성 → 거부', async () => {
  await seedDocs({ events: { r1: evt('r1', { type: 'reversal', amount: -1000, before: 1000, after: 0, target: 'p1', reason: 'x', createdAt: 1 }) } });
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  await assertFails(m.setDoc(r.act('p1'), mk('p1', { op: 'r1', kind: 'reversal' }))); // revPath 이미 존재 → !exists 위반
});
test('주문 요약만 변경 → 거부', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  await assertFails(m.updateDoc(r.order, { paidAmount: 1000, paymentStatus: 'partial' }));
});

// ── 가격/수량 보호 ────────────────────────────────────────
test('입금과 동시에 price 변경 → 거부', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('op1'), evt('op1', { type: 'payment', amount: 1000, before: 0, after: 1000 }));
  b.update(r.order, summary({ paidAmount: 1000, paymentStatus: 'partial', lastPaymentAmount: 1000, firstOperationId: 'op1', lastOperationId: 'op1', price: 2000 }));
  await assertFails(b.commit());
});
test('입금과 동시에 qty 변경 → 거부', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('op1'), evt('op1', { type: 'payment', amount: 1000, before: 0, after: 1000 }));
  b.update(r.order, summary({ paidAmount: 1000, paymentStatus: 'partial', lastPaymentAmount: 1000, firstOperationId: 'op1', lastOperationId: 'op1', qty: 999 }));
  await assertFails(b.commit());
});

// ── 서버시각 ──────────────────────────────────────────────
test('이벤트 createdAt이 request.time과 다르면 거부', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('op1'), evt('op1', { type: 'payment', amount: 1000, before: 0, after: 1000, createdAt: 12345 }));
  b.update(r.order, summary({ paidAmount: 1000, paymentStatus: 'partial', lastPaymentAmount: 1000, firstOperationId: 'op1', lastOperationId: 'op1' }));
  await assertFails(b.commit());
});
test('lastPaymentAt이 request.time과 다르면 거부', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('op1'), evt('op1', { type: 'payment', amount: 1000, before: 0, after: 1000 }));
  b.update(r.order, summary({ paidAmount: 1000, paymentStatus: 'partial', lastPaymentAmount: 1000, firstOperationId: 'op1', lastOperationId: 'op1', lastPaymentAt: 999 }));
  await assertFails(b.commit());
});
test('마커 createdAt이 request.time과 다르면 거부', async () => {
  await seedOrder({ paidAmount: 1000, paymentStatus: 'partial', paymentLedgerInitialized: true, paymentLedgerOpeningBalance: 0 });
  await seedDocs({ events: { p1: evt('p1', { type: 'payment', amount: 1000, before: 0, after: 1000, createdAt: 1 }) } });
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('r1'), evt('r1', { type: 'reversal', amount: -1000, before: 1000, after: 0, target: 'p1', reason: 'x' }));
  b.set(r.act('p1'), mk('p1', { op: 'r1', kind: 'reversal', createdAt: 999 }));
  b.update(r.order, summary({ paidAmount: 0, paymentStatus: 'unpaid', lastPaymentAmount: -1000, firstOperationId: 'r1', lastOperationId: 'r1' }));
  await assertFails(b.commit());
});

// ── 필드 형식 ─────────────────────────────────────────────
test('잘못된 paymentMethod → 거부', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('op1'), evt('op1', { type: 'payment', amount: 1000, before: 0, after: 1000, paymentMethod: 'crypto' }));
  b.update(r.order, summary({ paidAmount: 1000, paymentStatus: 'partial', lastPaymentAmount: 1000, firstOperationId: 'op1', lastOperationId: 'op1' }));
  await assertFails(b.commit());
});
test('paymentDate 누락(빈 문자열) → 거부', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('op1'), evt('op1', { type: 'payment', amount: 1000, before: 0, after: 1000, paymentDate: '' }));
  b.update(r.order, summary({ paidAmount: 1000, paymentStatus: 'partial', lastPaymentAmount: 1000, firstOperationId: 'op1', lastOperationId: 'op1' }));
  await assertFails(b.commit());
});
test('payment에 targetEventId/reason이 있으면 거부', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('op1'), evt('op1', { type: 'payment', amount: 1000, before: 0, after: 1000, target: 'x', reason: 'y' }));
  b.update(r.order, summary({ paidAmount: 1000, paymentStatus: 'partial', lastPaymentAmount: 1000, firstOperationId: 'op1', lastOperationId: 'op1' }));
  await assertFails(b.commit());
});

// ── 금액/상태 정합 & 위조 (기존 유지) ─────────────────────
test('afterPaidAmount 산술 불일치 → 거부', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('op1'), evt('op1', { type: 'payment', amount: 1000, before: 0, after: 999 }));
  b.update(r.order, summary({ paidAmount: 999, paymentStatus: 'partial', lastPaymentAmount: 1000, firstOperationId: 'op1', lastOperationId: 'op1' }));
  await assertFails(b.commit());
});
test('paidAmount>총액 → 거부', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('op1'), evt('op1', { type: 'payment', amount: 20000, before: 0, after: 20000 }));
  b.update(r.order, summary({ paidAmount: 20000, paymentStatus: 'paid', paidAt: ST(), lastPaymentAmount: 20000, firstOperationId: 'op1', lastOperationId: 'op1' }));
  await assertFails(b.commit());
});
test('paidAmount와 status 불일치 → 거부', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('op1'), evt('op1', { type: 'payment', amount: 1000, before: 0, after: 1000 }));
  b.update(r.order, summary({ paidAmount: 1000, paymentStatus: 'paid', paidAt: ST(), lastPaymentAmount: 1000, firstOperationId: 'op1', lastOperationId: 'op1' }));
  await assertFails(b.commit());
});
test('target amount와 reversal amount 불일치 → 거부', async () => {
  await seedOrder({ paidAmount: 1000, paymentStatus: 'partial', paymentLedgerInitialized: true, paymentLedgerOpeningBalance: 0 });
  await seedDocs({ events: { p1: evt('p1', { type: 'payment', amount: 1000, before: 0, after: 1000, createdAt: 1 }) } });
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('r1'), evt('r1', { type: 'reversal', amount: -500, before: 1000, after: 500, target: 'p1', reason: 'x' }));
  b.set(r.act('p1'), mk('p1', { op: 'r1', kind: 'reversal' }));
  b.update(r.order, summary({ paidAmount: 500, paymentStatus: 'partial', lastPaymentAmount: -500, firstOperationId: 'r1', lastOperationId: 'r1' }));
  await assertFails(b.commit());
});
test('actorRole admin 위조 → 거부', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('op1'), evt('op1', { type: 'payment', amount: 1000, before: 0, after: 1000, role: 'admin' }));
  b.update(r.order, summary({ paidAmount: 1000, paymentStatus: 'partial', lastPaymentAmount: 1000, firstOperationId: 'op1', lastOperationId: 'op1' }));
  await assertFails(b.commit());
});
test('영업은 입금 불가', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp1').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('op1'), evt('op1', { type: 'payment', amount: 1000, before: 0, after: 1000, uid: 'emp1', role: 'sales' }));
  b.update(r.order, summary({ paidAmount: 1000, paymentStatus: 'partial', lastPaymentAmount: 1000, firstOperationId: 'op1', lastOperationId: 'op1' }));
  await assertFails(b.commit());
});
test('같은 대상 두 번째 취소 → 거부(마커 불변)', async () => {
  await seedOrder({ paidAmount: 0, paymentStatus: 'unpaid', paymentLedgerInitialized: true, paymentLedgerOpeningBalance: 0 });
  await seedDocs({ events: { p1: evt('p1', { type: 'payment', amount: 1000, before: 0, after: 1000, createdAt: 1 }), r1: evt('r1', { type: 'reversal', amount: -1000, before: 1000, after: 0, target: 'p1', reason: 'x', createdAt: 1 }) }, markers: { p1: mk('p1', { op: 'r1', kind: 'reversal', createdAt: 1 }) } });
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('r2'), evt('r2', { type: 'reversal', amount: -1000, before: 0, after: -1000, target: 'p1', reason: 'y' }));
  b.set(r.act('p1'), mk('p1', { op: 'r2', kind: 'reversal' }));
  b.update(r.order, summary({ paidAmount: -1000, paymentStatus: 'unpaid', lastPaymentAmount: -1000, firstOperationId: 'r2', lastOperationId: 'r2' }));
  await assertFails(b.commit());
});

// ── 주문 생성 제한 / 비입금 / 불변 / 읽기 ─────────────────
test('영업 주문 생성 paidAmount 주입 거부 / 정상 허용', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp1').firestore();
  await assertFails(m.setDoc(m.doc(db, 'orders', 'N1'), { client: 'c', price: 1000, qty: 1, status: 'pending', paymentStatus: 'unpaid', paidAmount: 500 }));
  await assertSucceeds(m.setDoc(m.doc(db, 'orders', 'N2'), { client: 'c', price: 1000, qty: 1, status: 'pending', paymentStatus: 'unpaid' }));
});
test('관리자·회계 주문 생성 시 paid 주입 거부', async () => {
  const m = await fs();
  const acc = env.authenticatedContext('emp2').firestore();
  await assertFails(m.setDoc(m.doc(acc, 'orders', 'N3'), { client: 'c', price: 1000, qty: 1, status: 'completed', paymentStatus: 'paid', paidAmount: 1000 }));
  await assertSucceeds(m.setDoc(m.doc(acc, 'orders', 'N5'), { client: 'c', price: 1000, qty: 1, status: 'pending', paymentStatus: 'unpaid' }));
});
test('영업 lastPaymentAt 단독 변경 거부 / 비입금 필드 허용', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp1').firestore(); const r = R(db, m);
  await assertFails(m.updateDoc(r.order, { lastPaymentAt: 123 }));
  await assertSucceeds(m.updateDoc(r.order, { productionStage: 'packed', updatedAt: 1 }));
});
test('이벤트/마커 수정·삭제 불가, 이벤트 읽기 허용', async () => {
  await seedDocs({ events: { p1: evt('p1', { type: 'payment', amount: 1000, before: 0, after: 1000, createdAt: 1 }) }, markers: { p1: mk('p1', { op: 'r1', kind: 'reversal', createdAt: 1 }) } });
  const m = await fs();
  const adm = env.authenticatedContext('admin1').firestore(); const ra = R(adm, m);
  await assertFails(m.updateDoc(ra.ev('p1'), { amount: 9999 }));
  await assertFails(m.deleteDoc(ra.ev('p1')));
  await assertFails(m.updateDoc(ra.act('p1'), { kind: 'correction' }));
  const sales = env.authenticatedContext('emp1').firestore(); const rs = R(sales, m);
  await assertSucceeds(m.getDoc(rs.ev('p1')));
});
