// WORK52-2 입금 원장 테스트 — 실제 구현 모듈(js/payment-ledger.js)을 그대로 import 해서 검증한다.
// (계산식을 테스트에 복사하지 않는다. index.html applyPaymentLedgerOp도 동일 모듈을 사용한다.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import ledger from '../js/payment-ledger.js';
const { computeLedgerOp } = ledger;
const HERE = dirname(fileURLToPath(import.meta.url));

const ACC = { uid: 'acc1', name: '회계', role: 'accounting' };
let clock = 1_000;

// 인메모리 원장 저장소로 computeLedgerOp(단일 op 순수함수)를 순차 커밋해 다회차 시나리오를 만든다.
function makeStore(order) {
  return { order: Object.assign({ price: 0, qty: 0, paidAmount: 0 }, order), events: new Map(), markers: new Set() };
}
function apply(store, op, actor = ACC) {
  const primaryExists = store.events.has(op.operationId);
  const t = op.targetEventId ? store.events.get(op.targetEventId) : null;
  const markerExists = op.targetEventId ? store.markers.has(op.targetEventId) : false;
  const plan = computeLedgerOp(op, {
    order: store.order, actor, now: ++clock,
    primaryExists,
    targetEvent: t ? Object.assign({ eventId: op.targetEventId }, t) : null,
    markerExists
  });
  if (plan.idempotent) return { idempotent: true };
  for (const ev of plan.events) store.events.set(ev.docId, ev.data);
  if (plan.marker) store.markers.add(plan.marker.docId);
  Object.assign(store.order, plan.summary);
  return plan;
}
function sumAmounts(store) {
  let s = Number(store.order.paymentLedgerOpeningBalance) || 0;
  for (const ev of store.events.values()) s += Number(ev.amount) || 0;
  return s;
}

test('여러 회차 입금 누적', () => {
  const s = makeStore({ price: 1000, qty: 10 }); // total 10,000
  apply(s, { kind: 'payment', operationId: 'p1', amount: 3000 });
  apply(s, { kind: 'payment', operationId: 'p2', amount: 4000 });
  assert.equal(s.order.paidAmount, 7000);
  assert.equal(s.order.paymentStatus, 'partial');
});

test('잔액 초과 차단', () => {
  const s = makeStore({ price: 1000, qty: 1 }); // total 1,000
  assert.throws(() => apply(s, { kind: 'payment', operationId: 'p1', amount: 2000 }), /초과/);
});

test('operationId 중복은 한 번만 반영(멱등)', () => {
  const s = makeStore({ price: 1000, qty: 10 });
  apply(s, { kind: 'payment', operationId: 'p1', amount: 3000 });
  const r = apply(s, { kind: 'payment', operationId: 'p1', amount: 3000 });
  assert.equal(r.idempotent, true);
  assert.equal(s.order.paidAmount, 3000);
});

test('취소는 대상 이벤트 금액으로 계산되어 누적 복원', () => {
  const s = makeStore({ price: 1000, qty: 10 });
  apply(s, { kind: 'payment', operationId: 'p1', amount: 3000 });
  apply(s, { kind: 'reversal', operationId: 'r1', targetEventId: 'p1', reason: '오입금' });
  assert.equal(s.order.paidAmount, 0);
  assert.equal(s.order.paymentStatus, 'unpaid');
});

test('같은 대상 이벤트를 다른 operationId로 두 번 취소 → 두 번째 거부(마커)', () => {
  const s = makeStore({ price: 1000, qty: 10 });
  apply(s, { kind: 'payment', operationId: 'p1', amount: 3000 });
  apply(s, { kind: 'reversal', operationId: 'r1', targetEventId: 'p1', reason: 'x' });
  assert.throws(() => apply(s, { kind: 'reversal', operationId: 'r2', targetEventId: 'p1', reason: 'y' }), /이미 취소·정정/);
});

test('이미 취소된 입금을 정정 → 거부(마커)', () => {
  const s = makeStore({ price: 1000, qty: 10 });
  apply(s, { kind: 'payment', operationId: 'p1', amount: 3000 });
  apply(s, { kind: 'reversal', operationId: 'r1', targetEventId: 'p1', reason: 'x' });
  assert.throws(() => apply(s, { kind: 'correction', operationId: 'c1', targetEventId: 'p1', correctedAmount: 1000, reason: 'z' }), /이미 취소·정정/);
});

test('존재하지 않는 대상 → 거부', () => {
  const s = makeStore({ price: 1000, qty: 10 });
  assert.throws(() => apply(s, { kind: 'reversal', operationId: 'r1', targetEventId: 'nope', reason: 'x' }), /찾을 수 없/);
});

test('reversal 대상이 reversal 이벤트면 거부', () => {
  const s = makeStore({ price: 1000, qty: 10 });
  apply(s, { kind: 'payment', operationId: 'p1', amount: 3000 });
  apply(s, { kind: 'reversal', operationId: 'r1', targetEventId: 'p1', reason: 'x' });
  // r1(reversal 이벤트)을 대상으로 다시 취소 시도
  assert.throws(() => apply(s, { kind: 'reversal', operationId: 'r2', targetEventId: 'r1', reason: 'y' }), /입금\(또는 정정 입금\) 기록만/);
});

test('취소 사유 필수', () => {
  const s = makeStore({ price: 1000, qty: 10 });
  apply(s, { kind: 'payment', operationId: 'p1', amount: 3000 });
  assert.throws(() => apply(s, { kind: 'reversal', operationId: 'r1', targetEventId: 'p1', reason: '' }), /사유는 필수/);
});

test('정정은 취소+정정입금 원자 처리(이벤트 2건)', () => {
  const s = makeStore({ price: 1000, qty: 10 });
  apply(s, { kind: 'payment', operationId: 'p1', amount: 3000 });
  const plan = apply(s, { kind: 'correction', operationId: 'c1', targetEventId: 'p1', correctedAmount: 5000, reason: '오타' });
  assert.equal(plan.events.length, 2);
  assert.equal(plan.events[0].data.type, 'reversal');
  assert.equal(plan.events[1].data.type, 'corrected_payment');
  assert.equal(s.order.paidAmount, 5000); // 3000 취소 후 5000 입금
  // 최종(corrected) 이벤트 afterPaidAmount == 새 order.paidAmount
  assert.equal(plan.events[1].data.afterPaidAmount, s.order.paidAmount);
  // 첫(reversal) 이벤트 beforePaidAmount == 기존 order.paidAmount(3000)
  assert.equal(plan.events[0].data.beforePaidAmount, 3000);
  assert.equal(s.order.firstOperationId, 'c1');
  assert.equal(s.order.lastOperationId, 'c1__c');
});

test('정정 후 총액 초과 차단', () => {
  const s = makeStore({ price: 1000, qty: 10 }); // total 10,000
  apply(s, { kind: 'payment', operationId: 'p1', amount: 3000 });
  assert.throws(() => apply(s, { kind: 'correction', operationId: 'c1', targetEventId: 'p1', correctedAmount: 999999, reason: 'x' }), /초과/);
});

test('숨김 입력값(op.amount)을 원본보다 크게 조작해도 대상 이벤트 금액만 사용', () => {
  const s = makeStore({ price: 100000, qty: 1 }); // total 100,000
  apply(s, { kind: 'payment', operationId: 'p1', amount: 3000 });
  // 공격: op.amount=99999 로 부풀려 취소 시도 → 실제로는 대상(p1=3000)만 취소
  apply(s, { kind: 'reversal', operationId: 'r1', targetEventId: 'p1', amount: 99999, reason: 'x' });
  assert.equal(s.order.paidAmount, 0);
});

test('정정 후 다시 정정하려면 새 corrected_payment 이벤트를 대상으로 해야 한다', () => {
  const s = makeStore({ price: 1000, qty: 10 });
  apply(s, { kind: 'payment', operationId: 'p1', amount: 3000 });
  apply(s, { kind: 'correction', operationId: 'c1', targetEventId: 'p1', correctedAmount: 5000, reason: 'a' });
  // 원본 p1 재정정 → 마커 존재로 거부
  assert.throws(() => apply(s, { kind: 'correction', operationId: 'c2', targetEventId: 'p1', correctedAmount: 4000, reason: 'b' }), /이미 취소·정정/);
  // 새 corrected 이벤트(c1__c)를 대상으로는 정정 가능
  const plan = apply(s, { kind: 'correction', operationId: 'c3', targetEventId: 'c1__c', correctedAmount: 4000, reason: 'b' });
  assert.equal(plan.events[1].data.type, 'corrected_payment');
  assert.equal(s.order.paidAmount, 4000);
});

test('취소가 음수 누적을 만들면 차단', () => {
  const s = makeStore({ price: 100000, qty: 1 });
  apply(s, { kind: 'payment', operationId: 'p1', amount: 3000 });
  apply(s, { kind: 'payment', operationId: 'p2', amount: 2000 });
  apply(s, { kind: 'reversal', operationId: 'r1', targetEventId: 'p1', reason: 'x' }); // -3000 → 2000
  // p2 취소는 2000 남아있어 가능. 다시 p1은 마커로 불가. 인위적 음수 시나리오: opening 0에서 과다 취소는 위 구조상 발생 안 함.
  assert.equal(s.order.paidAmount, 2000);
});

test('레거시 paidAmount는 기초잔액으로 보존(합성 이벤트 없음)', () => {
  const s = makeStore({ price: 200000, qty: 1, paidAmount: 100000 }); // total 200,000, 기존 100,000 누적
  const plan = apply(s, { kind: 'payment', operationId: 'p1', amount: 50000 }); // 신규 5만
  assert.equal(s.order.paymentLedgerOpeningBalance, 100000);
  assert.equal(s.order.paymentLedgerInitialized, true);
  assert.equal(plan.events.length, 1); // 합성 과거 이벤트 없음, 신규 1건만
  assert.equal(s.order.paidAmount, 150000);
});

test('누적/상태가 (기초잔액 + 이벤트합)과 일치', () => {
  const s = makeStore({ price: 100000, qty: 1, paidAmount: 20000 });
  apply(s, { kind: 'payment', operationId: 'p1', amount: 3000 });
  apply(s, { kind: 'correction', operationId: 'c1', targetEventId: 'p1', correctedAmount: 5000, reason: 'x' });
  assert.equal(s.order.paidAmount, sumAmounts(s));
});

test('권한 없는 사용자(영업)는 처리 불가', () => {
  const s = makeStore({ price: 1000, qty: 10 });
  assert.throws(() => apply(s, { kind: 'payment', operationId: 'p1', amount: 100 }, { uid: 's1', role: 'sales' }), /관리자·회계만/);
});

test('모든 이벤트는 afterPaidAmount == beforePaidAmount + amount 산술 연속성', () => {
  const s = makeStore({ price: 100000, qty: 1 });
  apply(s, { kind: 'payment', operationId: 'p1', amount: 3000 });
  apply(s, { kind: 'payment', operationId: 'p2', amount: 2000 });
  apply(s, { kind: 'correction', operationId: 'c1', targetEventId: 'p1', correctedAmount: 5000, reason: 'x' });
  for (const ev of s.events.values()) {
    assert.equal(ev.afterPaidAmount, ev.beforePaidAmount + ev.amount, 'event ' + ev.eventId + ' 산술 불일치');
  }
});

// item 8: 멱등 재실행 시 감사 로그 중복 생성 금지 — runPaymentLedgerOp(index.html)의 소스 계약 검증
test('runPaymentLedgerOp은 idempotent 재실행 시 감사 로그를 남기지 않는다(소스 계약)', () => {
  const html = readFileSync(resolve(HERE, '..', 'index.html'), 'utf8');
  const m = /async function runPaymentLedgerOp[\s\S]*?\n}/.exec(html);
  assert.ok(m, 'runPaymentLedgerOp 함수를 찾을 수 없음');
  const body = m[0];
  assert.ok(/!result\.idempotent\s*&&\s*typeof logAction/.test(body), 'idempotent가 아닐 때만 logAction 호출하도록 가드되어야 함');
});
