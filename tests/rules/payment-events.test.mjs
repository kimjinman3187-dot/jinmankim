// WORK52-2 Rules 단위 테스트: paymentEvents 불변 원장 + 처리 마커 + 주문 입금필드 바인딩
// 실행: tests/rules 에서 `npm test`(firebase emulators:exec ... "node --test")
import { test, before, after, beforeEach } from 'node:test';
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { makeFirestoreEnv, seedUsers } from './helpers.mjs';

let env;
const OID = 'ORDER_PAY_1';

function fs() { return import('firebase/firestore'); }

function payEvent(opId, o = {}) {
  return {
    eventId: opId, operationId: opId, type: o.type || 'payment', amount: (o.amount === undefined ? 1000 : o.amount),
    paymentDate: '', paymentMethod: 'bank_transfer', senderName: '', reference: '', memo: '',
    targetEventId: o.target || '', reason: o.reason || '',
    actorUid: o.actorUid || 'emp2', actorName: '회계', actorRole: o.actorRole || 'accounting',
    createdAt: 1000, beforePaidAmount: (o.before === undefined ? 0 : o.before), afterPaidAmount: (o.after === undefined ? 1000 : o.after)
  };
}
function marker(target, opId, o = {}) {
  return { targetEventId: target, operationId: opId, kind: o.kind || 'reversal', actorUid: o.actorUid || 'emp2', actorRole: o.actorRole || 'accounting', createdAt: 1000 };
}

before(async () => { env = await makeFirestoreEnv(); await seedUsers(env); });
after(async () => { await env.cleanup(); });

// 기본: 주문(총 10,000, 미수) 1건
beforeEach(async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const { doc, setDoc, getDocs, collection, deleteDoc } = await fs();
    const db = ctx.firestore();
    for (const sub of ['paymentEvents', 'paymentEventActions']) {
      const s = await getDocs(collection(db, 'orders', OID, sub));
      for (const d of s.docs) await deleteDoc(d.ref);
    }
    await setDoc(doc(db, 'orders', OID), { client: '거래처', price: 1000, qty: 10, status: 'completed', paymentStatus: 'unpaid', paidAmount: 0 });
  });
});

function refs(db, mod) {
  const { doc } = mod;
  return {
    order: doc(db, 'orders', OID),
    ev: (id) => doc(db, 'orders', OID, 'paymentEvents', id),
    act: (id) => doc(db, 'orders', OID, 'paymentEventActions', id)
  };
}

// ── 생성 권한 ──────────────────────────────────────────────
test('회계는 입금 이벤트+요약을 바인딩 배치로 기록할 수 있다', async () => {
  const mod = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = refs(db, mod);
  const b = mod.writeBatch(db);
  b.set(r.ev('op1'), payEvent('op1', { amount: 1000, before: 0, after: 1000 }));
  b.update(r.order, { paidAmount: 1000, paymentStatus: 'partial', lastPaymentAt: 1000, firstOperationId: 'op1', lastOperationId: 'op1', updatedAt: 1000 });
  await assertSucceeds(b.commit());
});
test('관리자도 기록할 수 있다', async () => {
  const mod = await fs(); const db = env.authenticatedContext('admin1').firestore(); const r = refs(db, mod);
  const b = mod.writeBatch(db);
  b.set(r.ev('op1'), payEvent('op1', { actorUid: 'admin1', actorRole: 'admin', before: 0, after: 1000 }));
  b.update(r.order, { paidAmount: 1000, paymentStatus: 'partial', lastPaymentAt: 1000, firstOperationId: 'op1', lastOperationId: 'op1', updatedAt: 1000 });
  await assertSucceeds(b.commit());
});
test('영업은 입금 이벤트를 생성할 수 없다', async () => {
  const mod = await fs(); const db = env.authenticatedContext('emp1').firestore(); const r = refs(db, mod);
  await assertFails(mod.setDoc(r.ev('op1'), payEvent('op1', { actorUid: 'emp1', actorRole: 'sales' })));
});

// ── actorRole/actorUid 위조 ────────────────────────────────
test('회계가 actorRole을 admin으로 위조 → 거부', async () => {
  const mod = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = refs(db, mod);
  const b = mod.writeBatch(db);
  b.set(r.ev('op1'), payEvent('op1', { actorUid: 'emp2', actorRole: 'admin', before: 0, after: 1000 })); // 실제 역할 accounting
  b.update(r.order, { paidAmount: 1000, paymentStatus: 'partial', lastPaymentAt: 1000, firstOperationId: 'op1', lastOperationId: 'op1', updatedAt: 1000 });
  await assertFails(b.commit());
});
test('actorUid를 타인으로 위조 → 거부', async () => {
  const mod = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = refs(db, mod);
  await assertFails(mod.setDoc(r.ev('op1'), payEvent('op1', { actorUid: 'someoneelse' })));
});
test('허용되지 않은 추가 필드가 있으면 거부', async () => {
  const mod = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = refs(db, mod);
  const ev = payEvent('op1'); ev.evil = 'x';
  await assertFails(mod.setDoc(r.ev('op1'), ev));
});
test('eventId/operationId가 문서 id와 다르면 거부', async () => {
  const mod = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = refs(db, mod);
  await assertFails(mod.setDoc(r.ev('op1'), payEvent('DIFFERENT')));
});
test('payment 금액이 0/음수면 거부', async () => {
  const mod = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = refs(db, mod);
  await assertFails(mod.setDoc(r.ev('z0'), payEvent('z0', { amount: 0 })));
  await assertFails(mod.setDoc(r.ev('zn'), payEvent('zn', { amount: -5 })));
});

// ── 불변성 ────────────────────────────────────────────────
test('입금 이벤트는 수정·삭제 불가', async () => {
  const mod = await fs();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const m = await fs(); await m.setDoc(m.doc(ctx.firestore(), 'orders', OID, 'paymentEvents', 'op1'), payEvent('op1'));
  });
  const db = env.authenticatedContext('admin1').firestore(); const r = refs(db, mod);
  await assertFails(mod.updateDoc(r.ev('op1'), { amount: 9999 }));
  await assertFails(mod.deleteDoc(r.ev('op1')));
});

// ── 주문 입금필드 바인딩 ──────────────────────────────────
test('요약만 바꾸고 이벤트를 누락하면 거부', async () => {
  const mod = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = refs(db, mod);
  await assertFails(mod.updateDoc(r.order, { paidAmount: 1000, paymentStatus: 'partial' })); // first/lastOperationId 없음
  await assertFails(mod.updateDoc(r.order, { paidAmount: 1000, paymentStatus: 'partial', firstOperationId: 'ghost', lastOperationId: 'ghost' })); // 이벤트 없음
});
test('과거 이벤트를 재사용해 paidAmount만 변경 → 거부(!exists 위반)', async () => {
  const mod = await fs();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const m = await fs(); await m.setDoc(m.doc(ctx.firestore(), 'orders', OID, 'paymentEvents', 'old1'), payEvent('old1', { before: 0, after: 1000 }));
  });
  const db = env.authenticatedContext('emp2').firestore(); const r = refs(db, mod);
  await assertFails(mod.updateDoc(r.order, { paidAmount: 1000, paymentStatus: 'partial', firstOperationId: 'old1', lastOperationId: 'old1', lastPaymentAt: 2000 }));
});
test('이벤트 afterPaidAmount와 주문 paidAmount 불일치 → 거부', async () => {
  const mod = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = refs(db, mod);
  const b = mod.writeBatch(db);
  b.set(r.ev('op1'), payEvent('op1', { before: 0, after: 1000 }));
  b.update(r.order, { paidAmount: 9999, paymentStatus: 'partial', lastPaymentAt: 1000, firstOperationId: 'op1', lastOperationId: 'op1' }); // 9999 != 1000
  await assertFails(b.commit());
});
test('첫 이벤트 beforePaidAmount와 기존 order.paidAmount 불일치 → 거부', async () => {
  const mod = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = refs(db, mod);
  const b = mod.writeBatch(db);
  b.set(r.ev('op1'), payEvent('op1', { before: 500, after: 1500 })); // 기존 order.paidAmount는 0
  b.update(r.order, { paidAmount: 1500, paymentStatus: 'partial', lastPaymentAt: 1000, firstOperationId: 'op1', lastOperationId: 'op1' });
  await assertFails(b.commit());
});

// ── 취소·정정 마커(중복 처리 차단) ────────────────────────
async function seedPaidWithP1() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const m = await fs(); const db = ctx.firestore();
    await m.setDoc(m.doc(db, 'orders', OID), { client: '거래처', price: 1000, qty: 10, status: 'completed', paymentStatus: 'partial', paidAmount: 1000, paymentLedgerInitialized: true, paymentLedgerOpeningBalance: 0 });
    await m.setDoc(m.doc(db, 'orders', OID, 'paymentEvents', 'p1'), payEvent('p1', { before: 0, after: 1000 }));
  });
}
test('취소는 이벤트+마커+요약 배치로 허용', async () => {
  await seedPaidWithP1();
  const mod = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = refs(db, mod);
  const b = mod.writeBatch(db);
  b.set(r.ev('rev1'), payEvent('rev1', { type: 'reversal', amount: -1000, before: 1000, after: 0, target: 'p1', reason: '오입금' }));
  b.set(r.act('p1'), marker('p1', 'rev1', { kind: 'reversal' }));
  b.update(r.order, { paidAmount: 0, paymentStatus: 'unpaid', lastPaymentAt: 1000, firstOperationId: 'rev1', lastOperationId: 'rev1' });
  await assertSucceeds(b.commit());
});
test('reversal 이벤트에 마커를 함께 만들지 않으면 거부', async () => {
  await seedPaidWithP1();
  const mod = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = refs(db, mod);
  await assertFails(mod.setDoc(r.ev('rev1'), payEvent('rev1', { type: 'reversal', amount: -1000, before: 1000, after: 0, target: 'p1', reason: 'x' })));
});
test('같은 대상(p1)을 다른 operationId로 두 번 취소 → 두 번째 거부(마커 불변)', async () => {
  await seedPaidWithP1();
  // 1차 취소를 규칙 우회로 확정 상태로 심기
  await env.withSecurityRulesDisabled(async (ctx) => {
    const m = await fs(); const db = ctx.firestore();
    await m.setDoc(m.doc(db, 'orders', OID, 'paymentEvents', 'rev1'), payEvent('rev1', { type: 'reversal', amount: -1000, before: 1000, after: 0, target: 'p1', reason: 'x' }));
    await m.setDoc(m.doc(db, 'orders', OID, 'paymentEventActions', 'p1'), marker('p1', 'rev1'));
    await m.setDoc(m.doc(db, 'orders', OID), { client: '거래처', price: 1000, qty: 10, status: 'completed', paymentStatus: 'unpaid', paidAmount: 0, paymentLedgerInitialized: true, paymentLedgerOpeningBalance: 0 });
  });
  const mod = await fs(); const db = env.authenticatedContext('emp2').firestore(); const r = refs(db, mod);
  const b = mod.writeBatch(db);
  b.set(r.ev('rev2'), payEvent('rev2', { type: 'reversal', amount: -1000, before: 0, after: -1000, target: 'p1', reason: 'y' }));
  b.set(r.act('p1'), marker('p1', 'rev2')); // 이미 존재 → update 취급 → 거부
  b.update(r.order, { paidAmount: -1000, paymentStatus: 'unpaid', lastPaymentAt: 2000, firstOperationId: 'rev2', lastOperationId: 'rev2' });
  await assertFails(b.commit());
});
test('마커는 수정·삭제 불가', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const m = await fs(); await m.setDoc(m.doc(ctx.firestore(), 'orders', OID, 'paymentEventActions', 'p1'), marker('p1', 'rev1'));
  });
  const mod = await fs(); const db = env.authenticatedContext('admin1').firestore(); const r = refs(db, mod);
  await assertFails(mod.updateDoc(r.act('p1'), { kind: 'correction' }));
  await assertFails(mod.deleteDoc(r.act('p1')));
});

// ── 비입금 업무 필드(회귀) ────────────────────────────────
test('영업·생산의 비입금 필드 업데이트는 기존대로 허용', async () => {
  const mod = await fs(); const db = env.authenticatedContext('emp1').firestore(); const r = refs(db, mod);
  await assertSucceeds(mod.updateDoc(r.order, { productionStage: 'packed', updatedAt: Date.now() }));
});
test('영업이 lastPaymentAt만 변경 → 거부', async () => {
  const mod = await fs(); const db = env.authenticatedContext('emp1').firestore(); const r = refs(db, mod);
  await assertFails(mod.updateDoc(r.order, { lastPaymentAt: Date.now() }));
});

// ── 주문 생성 제한 ────────────────────────────────────────
test('영업 주문 생성 시 paidAmount 임의 입력 → 거부', async () => {
  const mod = await fs(); const db = env.authenticatedContext('emp1').firestore();
  await assertFails(mod.setDoc(mod.doc(db, 'orders', 'NEWO1'), { client: 'c', price: 1000, qty: 1, status: 'pending', paymentStatus: 'unpaid', paidAmount: 500 }));
});
test('영업 정상 주문 생성(unpaid, paidAmount 없음)은 허용', async () => {
  const mod = await fs(); const db = env.authenticatedContext('emp1').firestore();
  await assertSucceeds(mod.setDoc(mod.doc(db, 'orders', 'NEWO2'), { client: 'c', price: 1000, qty: 1, status: 'pending', paymentStatus: 'unpaid' }));
});

// ── 읽기 ──────────────────────────────────────────────────
test('입금 이벤트 읽기는 활성 사용자(영업 포함) 가능', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const m = await fs(); await m.setDoc(m.doc(ctx.firestore(), 'orders', OID, 'paymentEvents', 'op1'), payEvent('op1'));
  });
  const mod = await fs(); const db = env.authenticatedContext('emp1').firestore(); const r = refs(db, mod);
  await assertSucceeds(mod.getDoc(r.ev('op1')));
});
