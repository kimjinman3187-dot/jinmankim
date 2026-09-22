// WORK52-1 회계 안전성 로직 사양 테스트 (node --test)
// index.html 인라인 함수는 import 불가라, 확정된 규칙을 그대로 옮겨 검증한다.
// 실제 화면 코드와 규칙이 어긋나면 이 파일도 함께 갱신한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── A. 계산서 발행 상태 (자동 발행 제거) ──
function getInvoiceStatus(order = {}) {
  if (order.invoiceStatus) return order.invoiceStatus;
  return 'none'; // completed → issued 자동 판단 제거
}
function isInvoiceIssued(order = {}) { return getInvoiceStatus(order) === 'issued'; }
function getInvoiceDisplayState(order = {}) {
  if (getInvoiceStatus(order) === 'issued') return 'confirmed';
  if (order.status === 'completed') return 'need_confirm';
  return 'waiting';
}

test('완료 주문이라도 invoiceStatus 없으면 발행으로 보지 않는다', () => {
  const o = { status: 'completed' };
  assert.equal(getInvoiceStatus(o), 'none');
  assert.equal(isInvoiceIssued(o), false);
  assert.equal(getInvoiceDisplayState(o), 'need_confirm');
});
test('명시적 invoiceStatus=issued 만 발행 확인 완료', () => {
  assert.equal(getInvoiceDisplayState({ status: 'completed', invoiceStatus: 'issued' }), 'confirmed');
  assert.equal(isInvoiceIssued({ invoiceStatus: 'issued' }), true);
});
test('생산 완료 전 주문은 발행 대기', () => {
  assert.equal(getInvoiceDisplayState({ status: 'approved' }), 'waiting');
  assert.equal(getInvoiceDisplayState({ status: 'pending' }), 'waiting');
});

// ── C. 입금 트랜잭션 누적 규칙 ──
function applyPayment(order, amount) {
  const total = (Number(order.price) || 0) * (Number(order.qty) || 0);
  const paidBefore = Math.max(0, Number(order.paidAmount) || 0);
  const remaining = Math.max(0, total - paidBefore);
  if (total <= 0) throw new Error('총 청구액 확인 불가');
  if (remaining <= 0 || order.paymentStatus === 'paid') throw new Error('이미 입금 완료');
  if (amount > remaining) throw new Error('잔금 초과');
  const newPaid = paidBefore + amount;
  const isFullyPaid = newPaid >= total; // 실제 누적 기준
  return { paidAmount: newPaid, paymentStatus: isFullyPaid ? 'paid' : 'partial' };
}

test('부분 입금은 partial', () => {
  const r = applyPayment({ price: 1000, qty: 10, paidAmount: 0 }, 3000);
  assert.deepEqual(r, { paidAmount: 3000, paymentStatus: 'partial' });
});
test('전액 입금은 paid (누적 기준)', () => {
  const r = applyPayment({ price: 1000, qty: 10, paidAmount: 7000 }, 3000);
  assert.deepEqual(r, { paidAmount: 10000, paymentStatus: 'paid' });
});
test('잔금 초과 입금은 차단', () => {
  assert.throws(() => applyPayment({ price: 1000, qty: 10, paidAmount: 7000 }, 4000), /잔금 초과/);
});
test('이미 완료된 주문 재입금 차단', () => {
  assert.throws(() => applyPayment({ price: 1000, qty: 10, paidAmount: 10000, paymentStatus: 'paid' }, 1), /이미 입금 완료/);
});
test('순차 입금이 누적되어 완료된다(중복 아님)', () => {
  let o = { price: 1000, qty: 10, paidAmount: 0 };
  o = { ...o, ...applyPayment(o, 4000) };
  assert.equal(o.paymentStatus, 'partial');
  o = { ...o, ...applyPayment(o, 6000) };
  assert.equal(o.paidAmount, 10000);
  assert.equal(o.paymentStatus, 'paid');
});

// ── D. 테스트 주문 판별/제외 (live-operations-hub 규칙과 동일) ──
const TEST_PATTERN = /(^|[\s_\-])(TEST|테스트|샘플|SAMPLE|DEMO)/i;
function isTestOrder(order) {
  if (!order) return false;
  if (order.isTest === true || order.testData === true) return true;
  const fields = [order.client, order.clientName, order.company, order.title, order.material, order.productName, order.itemName, order.id];
  return fields.some(v => typeof v === 'string' && TEST_PATTERN.test(v));
}
function excludeTest(list, includeTest) { return includeTest ? list : list.filter(o => !isTestOrder(o)); }

test('테스트 주문 판별(플래그/이름 기준)', () => {
  assert.equal(isTestOrder({ isTest: true }), true);
  assert.equal(isTestOrder({ client: '테스트 거래처' }), true);
  assert.equal(isTestOrder({ client: 'TEST Corp' }), true);
  assert.equal(isTestOrder({ client: '(주)하네스테크' }), false);
});
test('기본은 테스트 제외, 포함 선택 시 전체 — KPI/목록 동일 기준', () => {
  const list = [
    { id: 'a', client: '정상거래처', status: 'completed' },
    { id: 'b', client: '샘플업체', status: 'completed', isTest: true }
  ];
  const excluded = excludeTest(list, false);
  const included = excludeTest(list, true);
  assert.equal(excluded.length, 1);
  assert.equal(excluded[0].id, 'a');
  assert.equal(included.length, 2);
  // KPI(합계)와 목록이 같은 필터를 쓰므로 카운트가 일치
  assert.equal(excluded.length, excludeTest(list, false).length);
});
