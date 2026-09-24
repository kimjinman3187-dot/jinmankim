// WORK52-2 입금 이벤트 원장 로직 사양 테스트 (node --test)
// index.html applyPaymentLedgerOp의 순수 규칙을 그대로 옮겨 검증한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';

function initState(order) {
  return {
    total: (Number(order.price) || 0) * (Number(order.qty) || 0),
    paid: Math.max(0, Number(order.paidAmount) || 0),
    opening: Number(order.paymentLedgerOpeningBalance) || 0,
    initialized: !!order.paymentLedgerInitialized,
    paidAt: order.paidAt || null,
    appliedOps: new Set(),
    events: []
  };
}
function statusOf(s) { return s.paid <= 0 ? 'unpaid' : ((s.paid >= s.total && s.paid > 0) ? 'paid' : 'partial'); }
// 트랜잭션 1회를 모사. 멱등: 같은 operationId 재적용은 무시.
function applyOp(s, op) {
  if (s.appliedOps.has(op.operationId)) return s; // idempotent
  if (s.total <= 0) throw new Error('총 청구액 없음');
  const before = s.paid;
  let opening = s.opening, initialized = s.initialized;
  if (!initialized) { opening = before; initialized = true; } // 레거시 기초잔액 보존
  let after = before;
  const newEvents = [];
  if (op.kind === 'payment') {
    if (!(op.amount > 0)) throw new Error('입금액');
    if (before + op.amount > s.total) throw new Error('잔금 초과');
    after = before + op.amount;
    newEvents.push({ type: 'payment', amount: op.amount, operationId: op.operationId });
  } else if (op.kind === 'reversal') {
    if (!(op.amount > 0)) throw new Error('취소 금액');
    if (!op.reason) throw new Error('사유 필수');
    if (before - op.amount < 0) throw new Error('음수');
    after = before - op.amount;
    newEvents.push({ type: 'reversal', amount: -op.amount, operationId: op.operationId, targetEventId: op.targetEventId });
  } else if (op.kind === 'correction') {
    if (!(op.amount > 0) || !(op.correctedAmount > 0)) throw new Error('정정 금액');
    if (!op.reason) throw new Error('사유 필수');
    const rev = before - op.amount; if (rev < 0) throw new Error('음수');
    const pay = rev + op.correctedAmount; if (pay > s.total) throw new Error('잔금 초과');
    after = pay;
    newEvents.push({ type: 'reversal', amount: -op.amount, operationId: op.operationId });
    newEvents.push({ type: 'corrected_payment', amount: op.correctedAmount, operationId: op.operationId + '__c' });
  } else throw new Error('유형');
  const fully = after >= s.total && after > 0;
  return { ...s, paid: after, opening, initialized, paidAt: fully ? (s.paidAt || 1) : null, appliedOps: new Set([...s.appliedOps, op.operationId]), events: [...s.events, ...newEvents] };
}

test('여러 회차 입금 누적', () => {
  let s = initState({ price: 1000, qty: 10 }); // total 10000
  s = applyOp(s, { operationId: 'o1', kind: 'payment', amount: 4000 });
  assert.equal(statusOf(s), 'partial');
  s = applyOp(s, { operationId: 'o2', kind: 'payment', amount: 3000 });
  assert.equal(s.paid, 7000);
  s = applyOp(s, { operationId: 'o3', kind: 'payment', amount: 3000 });
  assert.equal(s.paid, 10000);
  assert.equal(statusOf(s), 'paid');
  assert.equal(s.events.length, 3);
});
test('잔액 초과 차단', () => {
  let s = initState({ price: 1000, qty: 10, paidAmount: 7000 });
  assert.throws(() => applyOp(s, { operationId: 'x', kind: 'payment', amount: 4000 }), /잔금 초과/);
});
test('operationId 중복은 한 번만 반영(멱등)', () => {
  let s = initState({ price: 1000, qty: 10 });
  s = applyOp(s, { operationId: 'dup', kind: 'payment', amount: 5000 });
  s = applyOp(s, { operationId: 'dup', kind: 'payment', amount: 5000 }); // 두 번째 무시
  assert.equal(s.paid, 5000);
  assert.equal(s.events.length, 1);
});
test('취소 후 누적 복원', () => {
  let s = initState({ price: 1000, qty: 10 });
  s = applyOp(s, { operationId: 'p1', kind: 'payment', amount: 5000 });
  s = applyOp(s, { operationId: 'r1', kind: 'reversal', amount: 5000, targetEventId: 'p1', reason: '중복 입력' });
  assert.equal(s.paid, 0);
  assert.equal(statusOf(s), 'unpaid');
  assert.equal(s.events.length, 2); // 원본 보존 + 취소
});
test('중복 취소 차단(같은 operationId)', () => {
  let s = initState({ price: 1000, qty: 10 });
  s = applyOp(s, { operationId: 'p1', kind: 'payment', amount: 5000 });
  s = applyOp(s, { operationId: 'r1', kind: 'reversal', amount: 5000, targetEventId: 'p1', reason: 'x' });
  s = applyOp(s, { operationId: 'r1', kind: 'reversal', amount: 5000, targetEventId: 'p1', reason: 'x' }); // 무시
  assert.equal(s.paid, 0);
  assert.equal(s.events.length, 2);
});
test('취소 사유 필수', () => {
  let s = initState({ price: 1000, qty: 10, paidAmount: 5000 });
  assert.throws(() => applyOp(s, { operationId: 'r', kind: 'reversal', amount: 5000, reason: '' }), /사유/);
});
test('정정은 취소+정정입금 원자 처리', () => {
  let s = initState({ price: 1000, qty: 10 });
  s = applyOp(s, { operationId: 'p1', kind: 'payment', amount: 5000 });
  s = applyOp(s, { operationId: 'c1', kind: 'correction', amount: 5000, correctedAmount: 3000, targetEventId: 'p1', reason: '실제 입금액 정정' });
  assert.equal(s.paid, 3000); // 5000 취소 + 3000 정정입금
  assert.equal(statusOf(s), 'partial');
  const last2 = s.events.slice(-2).map(e => e.type);
  assert.deepEqual(last2, ['reversal', 'corrected_payment']);
});
test('정정 후 총액 초과 차단', () => {
  let s = initState({ price: 1000, qty: 10 });
  s = applyOp(s, { operationId: 'p1', kind: 'payment', amount: 5000 });
  assert.throws(() => applyOp(s, { operationId: 'c', kind: 'correction', amount: 5000, correctedAmount: 12000, reason: 'x' }), /잔금 초과/);
});
test('취소가 음수 누적을 만들면 차단', () => {
  let s = initState({ price: 1000, qty: 10, paidAmount: 3000 });
  assert.throws(() => applyOp(s, { operationId: 'r', kind: 'reversal', amount: 5000, reason: 'x' }), /음수/);
});
test('레거시 paidAmount는 기초잔액으로 보존(합성 이벤트 없음)', () => {
  let s = initState({ price: 1000, qty: 10, paidAmount: 3000 }); // 기존 누적 3000, 이벤트 없음
  s = applyOp(s, { operationId: 'p1', kind: 'payment', amount: 2000 });
  assert.equal(s.opening, 3000);        // 기초잔액 보존
  assert.equal(s.initialized, true);
  assert.equal(s.paid, 5000);           // 기초 + 신규
  assert.equal(s.events.length, 1);     // 신규 1건만(과거 합성 없음)
});
test('누적/상태가 이벤트 합과 일치', () => {
  let s = initState({ price: 1000, qty: 10 });
  s = applyOp(s, { operationId: 'p1', kind: 'payment', amount: 4000 });
  s = applyOp(s, { operationId: 'p2', kind: 'payment', amount: 3000 });
  s = applyOp(s, { operationId: 'r1', kind: 'reversal', amount: 3000, targetEventId: 'p2', reason: 'x' });
  const sum = s.opening + s.events.reduce((a, e) => a + e.amount, 0);
  assert.equal(s.paid, sum);
  assert.equal(s.paid, 4000);
});
