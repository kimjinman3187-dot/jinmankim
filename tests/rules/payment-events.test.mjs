// WORK52-2 Rules 무결성 테스트: paymentEvents 불변 원장 + 처리 마커 + 주문 요약 바인딩(무결성 강화)
import { test, before, after, beforeEach } from 'node:test';
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { makeFirestoreEnv, seedUsers } from './helpers.mjs';

let env;
const OID = 'ORDER_PAY_1';
const T = 10000; // 총액(price 1000 * qty 10)
function fs() { return import('firebase/firestore'); }

function evt(id, o) {
  return {
    eventId: id, operationId: id, type: o.type, amount: o.amount,
    paymentDate: '', paymentMethod: 'bank_transfer', senderName: '', reference: '', memo: '',
    targetEventId: o.target || '', reason: o.reason || '',
    actorUid: o.uid || 'emp2', actorName: '회계', actorRole: o.role || 'accounting',
    createdAt: 1000, beforePaidAmount: o.before, afterPaidAmount: o.after
  };
}
function mk(target, o) {
  return { targetEventId: target, operationId: o.op, kind: o.kind, actorUid: o.uid || 'emp2', actorRole: o.role || 'accounting', createdAt: 1000 };
}
function summary(o) {
  return Object.assign({
    paidAt: null, paymentLedgerInitialized: true, paymentLedgerOpeningBalance: 0, updatedAt: 1000
  }, o);
}

before(async () => { env = await makeFirestoreEnv(); await seedUsers(env); });
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
async function seedDocs(docs) { // {events:{id:evt}, markers:{id:mk}}
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

// ── 정상 경로 ─────────────────────────────────────────────
test('회계 입금(이벤트+요약) 배치 허용', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('op1'), evt('op1', { type: 'payment', amount: 1000, before: 0, after: 1000 }));
  b.update(r.order, summary({ paidAmount: 1000, paymentStatus: 'partial', lastPaymentAmount: 1000, lastPaymentAt: 1000, firstOperationId: 'op1', lastOperationId: 'op1' }));
  await assertSucceeds(b.commit());
});
test('완납 시 paidAt 필수(정상)', async () => {
  await seedOrder({ paidAmount: 9000, paymentStatus: 'partial', paymentLedgerInitialized: true, paymentLedgerOpeningBalance: 0 });
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('op2'), evt('op2', { type: 'payment', amount: 1000, before: 9000, after: 10000 }));
  b.update(r.order, summary({ paidAmount: 10000, paymentStatus: 'paid', paidAt: 1000, lastPaymentAmount: 1000, lastPaymentAt: 1000, firstOperationId: 'op2', lastOperationId: 'op2' }));
  await assertSucceeds(b.commit());
});
test('취소(이벤트+마커+요약) 배치 허용', async () => {
  await seedOrder({ paidAmount: 1000, paymentStatus: 'partial', paymentLedgerInitialized: true, paymentLedgerOpeningBalance: 0 });
  await seedDocs({ events: { p1: evt('p1', { type: 'payment', amount: 1000, before: 0, after: 1000 }) } });
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('r1'), evt('r1', { type: 'reversal', amount: -1000, before: 1000, after: 0, target: 'p1', reason: 'x' }));
  b.set(r.act('p1'), mk('p1', { op: 'r1', kind: 'reversal' }));
  b.update(r.order, summary({ paidAmount: 0, paymentStatus: 'unpaid', lastPaymentAmount: -1000, lastPaymentAt: 1000, firstOperationId: 'r1', lastOperationId: 'r1' }));
  await assertSucceeds(b.commit());
});
test('정정(reversal+corrected+마커+요약) 배치 허용', async () => {
  await seedOrder({ paidAmount: 3000, paymentStatus: 'partial', paymentLedgerInitialized: true, paymentLedgerOpeningBalance: 0 });
  await seedDocs({ events: { p1: evt('p1', { type: 'payment', amount: 3000, before: 0, after: 3000 }) } });
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('c1'), evt('c1', { type: 'reversal', amount: -3000, before: 3000, after: 0, target: 'p1', reason: 'fix' }));
  b.set(r.ev('c1__c'), evt('c1__c', { type: 'corrected_payment', amount: 5000, before: 0, after: 5000, target: 'p1', reason: 'fix' }));
  b.set(r.act('p1'), mk('p1', { op: 'c1', kind: 'correction' }));
  b.update(r.order, summary({ paidAmount: 5000, paymentStatus: 'partial', lastPaymentAmount: 5000, lastPaymentAt: 1000, firstOperationId: 'c1', lastOperationId: 'c1__c' }));
  await assertSucceeds(b.commit());
});

// ── 권한/위조/필드 ────────────────────────────────────────
test('영업은 입금 이벤트 생성 불가', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp1').firestore(); const r = R(db, m);
  await assertFails(m.setDoc(r.ev('op1'), evt('op1', { type: 'payment', amount: 1000, before: 0, after: 1000, uid: 'emp1', role: 'sales' })));
});
test('actorRole admin 위조 거부', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  await assertFails(m.setDoc(r.ev('op1'), evt('op1', { type: 'payment', amount: 1000, before: 0, after: 1000, role: 'admin' })));
});
test('허용외 필드/문서id 불일치 거부', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const e = evt('op1', { type: 'payment', amount: 1000, before: 0, after: 1000 }); e.evil = 1;
  await assertFails(m.setDoc(r.ev('op1'), e));
  await assertFails(m.setDoc(r.ev('op1'), evt('DIFF', { type: 'payment', amount: 1000, before: 0, after: 1000 })));
});
test('afterPaidAmount 산술 불일치 거부', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  await assertFails(m.setDoc(r.ev('op1'), evt('op1', { type: 'payment', amount: 1000, before: 0, after: 999 })));
});
test('payment 0/음수 거부', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  await assertFails(m.setDoc(r.ev('z'), evt('z', { type: 'payment', amount: 0, before: 0, after: 0 })));
});

// ── 대상 이벤트 검증 ──────────────────────────────────────
test('존재하지 않는 targetEventId 취소 거부', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('r1'), evt('r1', { type: 'reversal', amount: -1000, before: 1000, after: 0, target: 'ghost', reason: 'x' }));
  b.set(r.act('ghost'), mk('ghost', { op: 'r1', kind: 'reversal' }));
  await assertFails(b.commit());
});
test('target amount와 reversal amount 불일치 거부', async () => {
  await seedDocs({ events: { p1: evt('p1', { type: 'payment', amount: 1000, before: 0, after: 1000 }) } });
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('r1'), evt('r1', { type: 'reversal', amount: -500, before: 1000, after: 500, target: 'p1', reason: 'x' })); // -500 != -1000
  b.set(r.act('p1'), mk('p1', { op: 'r1', kind: 'reversal' }));
  b.update(r.order, summary({ paidAmount: 500, paymentStatus: 'partial', lastPaymentAmount: -500, lastPaymentAt: 1000, firstOperationId: 'r1', lastOperationId: 'r1', paidAmount: 500 }));
  await assertFails(b.commit());
});
test('reversal에 마커 동시 생성 없으면 거부', async () => {
  await seedDocs({ events: { p1: evt('p1', { type: 'payment', amount: 1000, before: 0, after: 1000 }) } });
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  await assertFails(m.setDoc(r.ev('r1'), evt('r1', { type: 'reversal', amount: -1000, before: 1000, after: 0, target: 'p1', reason: 'x' })));
});

// ── 마커 검증 ─────────────────────────────────────────────
test('마커 operationId 불일치 거부', async () => {
  await seedOrder({ paidAmount: 1000, paymentStatus: 'partial', paymentLedgerInitialized: true, paymentLedgerOpeningBalance: 0 });
  await seedDocs({ events: { p1: evt('p1', { type: 'payment', amount: 1000, before: 0, after: 1000 }) } });
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('r1'), evt('r1', { type: 'reversal', amount: -1000, before: 1000, after: 0, target: 'p1', reason: 'x' }));
  b.set(r.act('p1'), mk('p1', { op: 'WRONG', kind: 'reversal' })); // operationId != r1
  b.update(r.order, summary({ paidAmount: 0, paymentStatus: 'unpaid', lastPaymentAmount: -1000, lastPaymentAt: 1000, firstOperationId: 'r1', lastOperationId: 'r1' }));
  await assertFails(b.commit());
});
test('마커 kind 불일치 거부(취소인데 correction)', async () => {
  await seedOrder({ paidAmount: 1000, paymentStatus: 'partial', paymentLedgerInitialized: true, paymentLedgerOpeningBalance: 0 });
  await seedDocs({ events: { p1: evt('p1', { type: 'payment', amount: 1000, before: 0, after: 1000 }) } });
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('r1'), evt('r1', { type: 'reversal', amount: -1000, before: 1000, after: 0, target: 'p1', reason: 'x' }));
  b.set(r.act('p1'), mk('p1', { op: 'r1', kind: 'correction' })); // corrected 없음인데 correction
  b.update(r.order, summary({ paidAmount: 0, paymentStatus: 'unpaid', lastPaymentAmount: -1000, lastPaymentAt: 1000, firstOperationId: 'r1', lastOperationId: 'r1' }));
  await assertFails(b.commit());
});
test('같은 대상 두 번째 취소 거부(마커 불변)', async () => {
  await seedOrder({ paidAmount: 0, paymentStatus: 'unpaid', paymentLedgerInitialized: true, paymentLedgerOpeningBalance: 0 });
  await seedDocs({ events: { p1: evt('p1', { type: 'payment', amount: 1000, before: 0, after: 1000 }), r1: evt('r1', { type: 'reversal', amount: -1000, before: 1000, after: 0, target: 'p1', reason: 'x' }) }, markers: { p1: mk('p1', { op: 'r1', kind: 'reversal' }) } });
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('r2'), evt('r2', { type: 'reversal', amount: -1000, before: 0, after: -1000, target: 'p1', reason: 'y' }));
  b.set(r.act('p1'), mk('p1', { op: 'r2', kind: 'reversal' })); // 이미 존재 → update 취급 거부
  b.update(r.order, summary({ paidAmount: 0, paymentStatus: 'unpaid', lastPaymentAmount: -1000, lastPaymentAt: 1000, firstOperationId: 'r2', lastOperationId: 'r2' }));
  await assertFails(b.commit());
});

// ── 주문 요약 바인딩(격리: rules-disabled로 이벤트/마커 심고 order update만 시도) ──
test('과거 이벤트를 lastOperationId로 재사용 거부(!exists 위반)', async () => {
  await seedDocs({ events: { old1: evt('old1', { type: 'payment', amount: 1000, before: 0, after: 1000 }) } });
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  await assertFails(m.updateDoc(r.order, summary({ paidAmount: 1000, paymentStatus: 'partial', lastPaymentAmount: 1000, lastPaymentAt: 1000, firstOperationId: 'old1', lastOperationId: 'old1' })));
});
test('요약만 바꾸고 이벤트 누락 거부', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  await assertFails(m.updateDoc(r.order, { paidAmount: 1000, paymentStatus: 'partial' }));
});
test('paidAmount와 paymentStatus 불일치 거부', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('op1'), evt('op1', { type: 'payment', amount: 1000, before: 0, after: 1000 }));
  b.update(r.order, summary({ paidAmount: 1000, paymentStatus: 'paid', lastPaymentAmount: 1000, lastPaymentAt: 1000, firstOperationId: 'op1', lastOperationId: 'op1', paidAt: 1000 })); // 1000<10000인데 paid
  await assertFails(b.commit());
});
test('paidAmount가 총액 초과하는 요약 거부', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('op1'), evt('op1', { type: 'payment', amount: 20000, before: 0, after: 20000 }));
  b.update(r.order, summary({ paidAmount: 20000, paymentStatus: 'paid', paidAt: 1000, lastPaymentAmount: 20000, lastPaymentAt: 1000, firstOperationId: 'op1', lastOperationId: 'op1' }));
  await assertFails(b.commit());
});
test('lastPaymentAmount가 최종 이벤트와 불일치 거부', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('op1'), evt('op1', { type: 'payment', amount: 1000, before: 0, after: 1000 }));
  b.update(r.order, summary({ paidAmount: 1000, paymentStatus: 'partial', lastPaymentAmount: 777, lastPaymentAt: 1000, firstOperationId: 'op1', lastOperationId: 'op1' }));
  await assertFails(b.commit());
});
test('opening balance 재변경 거부', async () => {
  await seedOrder({ paidAmount: 1000, paymentStatus: 'partial', paymentLedgerInitialized: true, paymentLedgerOpeningBalance: 0 });
  await seedDocs({ events: { p1: evt('p1', { type: 'payment', amount: 1000, before: 0, after: 1000 }) } });
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  const b = m.writeBatch(db);
  b.set(r.ev('op2'), evt('op2', { type: 'payment', amount: 1000, before: 1000, after: 2000 }));
  b.update(r.order, summary({ paidAmount: 2000, paymentStatus: 'partial', paymentLedgerOpeningBalance: 999, lastPaymentAmount: 1000, lastPaymentAt: 1000, firstOperationId: 'op2', lastOperationId: 'op2' })); // opening 0→999 금지
  await assertFails(b.commit());
});
test('correction: reversal.after != corrected.before 거부(격리)', async () => {
  await seedOrder({ paidAmount: 3000, paymentStatus: 'partial', paymentLedgerInitialized: true, paymentLedgerOpeningBalance: 0 });
  await seedDocs({
    events: {
      c1: evt('c1', { type: 'reversal', amount: -3000, before: 3000, after: 0, target: 'p1', reason: 'fix' }),
      c1__c: evt('c1__c', { type: 'corrected_payment', amount: 5000, before: 1000, after: 6000, target: 'p1', reason: 'fix' }) // before 1000 != reversal.after 0
    },
    markers: { p1: mk('p1', { op: 'c1', kind: 'correction' }) }
  });
  const m = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = R(db, m);
  // 이벤트/마커는 이미 존재 상태 → order update만 시도(!exists 위반으로도, 연결 불일치로도 거부)
  await assertFails(m.updateDoc(r.order, summary({ paidAmount: 6000, paymentStatus: 'partial', lastPaymentAmount: 5000, lastPaymentAt: 1000, firstOperationId: 'c1', lastOperationId: 'c1__c' })));
});

// ── 비입금/생성 ──────────────────────────────────────────
test('영업·생산 비입금 필드 업데이트 허용(회귀)', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp1').firestore(); const r = R(db, m);
  await assertSucceeds(m.updateDoc(r.order, { productionStage: 'packed', updatedAt: Date.now() }));
});
test('영업 lastPaymentAt 단독 변경 거부', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp1').firestore(); const r = R(db, m);
  await assertFails(m.updateDoc(r.order, { lastPaymentAt: Date.now() }));
});
test('영업 주문 생성 paidAmount 주입 거부 / 정상 생성 허용', async () => {
  const m = await fs(); const db = env.authenticatedContext('emp1').firestore();
  await assertFails(m.setDoc(m.doc(db, 'orders', 'N1'), { client: 'c', price: 1000, qty: 1, status: 'pending', paymentStatus: 'unpaid', paidAmount: 500 }));
  await assertSucceeds(m.setDoc(m.doc(db, 'orders', 'N2'), { client: 'c', price: 1000, qty: 1, status: 'pending', paymentStatus: 'unpaid' }));
});
test('관리자·회계도 주문 생성 시 paidAmount/paid 주입 거부', async () => {
  const m = await fs();
  const acc = env.authenticatedContext('emp2').firestore();
  await assertFails(m.setDoc(m.doc(acc, 'orders', 'N3'), { client: 'c', price: 1000, qty: 1, status: 'completed', paymentStatus: 'paid', paidAmount: 1000 }));
  const adm = env.authenticatedContext('admin1').firestore();
  await assertFails(m.setDoc(m.doc(adm, 'orders', 'N4'), { client: 'c', price: 1000, qty: 1, status: 'completed', paymentStatus: 'paid', paidAmount: 1000, paidAt: 1 }));
  await assertSucceeds(m.setDoc(m.doc(acc, 'orders', 'N5'), { client: 'c', price: 1000, qty: 1, status: 'pending', paymentStatus: 'unpaid' }));
});

// ── 불변/읽기 ─────────────────────────────────────────────
test('이벤트/마커는 수정·삭제 불가', async () => {
  await seedDocs({ events: { p1: evt('p1', { type: 'payment', amount: 1000, before: 0, after: 1000 }) }, markers: { p1: mk('p1', { op: 'r1', kind: 'reversal' }) } });
  const m = await fs(); const db = env.authenticatedContext('admin1').firestore(); const r = R(db, m);
  await assertFails(m.updateDoc(r.ev('p1'), { amount: 9999 }));
  await assertFails(m.deleteDoc(r.ev('p1')));
  await assertFails(m.updateDoc(r.act('p1'), { kind: 'correction' }));
  await assertFails(m.deleteDoc(r.act('p1')));
});
test('이벤트 읽기는 활성 사용자(영업) 가능', async () => {
  await seedDocs({ events: { p1: evt('p1', { type: 'payment', amount: 1000, before: 0, after: 1000 }) } });
  const m = await fs(); const db = env.authenticatedContext('emp1').firestore(); const r = R(db, m);
  await assertSucceeds(m.getDoc(r.ev('p1')));
});
