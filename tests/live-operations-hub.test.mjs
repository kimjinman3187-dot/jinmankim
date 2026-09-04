import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// WORK41: 업무 홈 '최근 업무' 명시 정렬/지연 판별 회귀 테스트.
// 프로덕션 소스(js/live-operations-hub.js)를 그대로 vm 로 로드해 __test 순수 함수를 검증한다.
const SOURCE = new URL('../js/live-operations-hub.js', import.meta.url);

function loadHub() {
    const code = fs.readFileSync(SOURCE, 'utf8');
    const noopEl = () => ({
        className: '', textContent: '', dataset: {},
        classList: { add() {}, remove() {}, toggle() {} },
        append() {}, appendChild() {}, addEventListener() {}
    });
    const document = {
        addEventListener() {},
        getElementById() { return null; },
        createElement() { return noopEl(); },
        querySelectorAll() { return []; }
    };
    const window = { addEventListener() {}, setTimeout() {}, document };
    const context = { window, document, console };
    vm.createContext(context);
    vm.runInContext(code, context);
    assert.ok(window.YJLiveOperationsHub && window.YJLiveOperationsHub.__test, 'hub __test exports present');
    return window.YJLiveOperationsHub.__test;
}

const T = loadHub();
const NOW = new Date('2026-09-04T00:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;
function order(id, status, dueOffsetDays, updatedAt) {
    return {
        id,
        status,
        dueDate: new Date(NOW + dueOffsetDays * DAY).toISOString().slice(0, 10),
        updatedAt: updatedAt == null ? NOW : updatedAt
    };
}

test('완료 상태가 미처리 상태보다 먼저 오지 않는다', () => {
    const orders = [order('c', 'completed', -1), order('p', 'pending', 5), order('a', 'approved', 5)];
    const sorted = T.sortRecentOrders(orders, { includeCompleted: true, nowMs: NOW });
    const completedIdx = sorted.findIndex(o => o.status === 'completed');
    const pendingIdx = sorted.findIndex(o => o.status === 'pending');
    const approvedIdx = sorted.findIndex(o => o.status === 'approved');
    assert.ok(completedIdx > pendingIdx, '완료가 대기보다 뒤여야 한다');
    assert.ok(completedIdx > approvedIdx, '완료가 진행보다 뒤여야 한다');
    assert.equal(sorted[sorted.length - 1].status, 'completed');
});

test("완료 미포함('완료 포함' 미선택) 시 완료 주문은 목록에서 제외된다", () => {
    const orders = [order('c', 'completed', -1), order('p', 'pending', 5)];
    const sorted = T.sortRecentOrders(orders, { includeCompleted: false, nowMs: NOW });
    assert.equal(sorted.length, 1);
    assert.equal(sorted[0].status, 'pending');
});

test('지연 주문이 최우선(rank 0)으로 정렬된다', () => {
    const delayed = order('d', 'approved', -2); // 납기 지남 + 미완료
    assert.equal(T.isDelayedOrder(delayed, NOW), true);
    assert.equal(T.orderPriorityRank(delayed, NOW), 0);
    const orders = [order('a', 'approved', 5), delayed, order('p', 'pending', 5)];
    const sorted = T.sortRecentOrders(orders, { includeCompleted: true, nowMs: NOW });
    assert.equal(sorted[0].id, 'd', '지연 주문이 맨 앞이어야 한다');
});

test('완료·반려 주문은 납기가 지나도 지연으로 보지 않는다', () => {
    assert.equal(T.isDelayedOrder(order('x', 'completed', -5), NOW), false);
    assert.equal(T.isDelayedOrder(order('y', 'rejected', -5), NOW), false);
});

test('납기 임박(3일 이내) 판별', () => {
    assert.equal(T.isDueSoonOrder(order('s', 'pending', 2), NOW), true);
    assert.equal(T.isDueSoonOrder(order('f', 'pending', 10), NOW), false);
    assert.equal(T.isDueSoonOrder(order('done', 'completed', 1), NOW), false);
});

test('우선순위 순서: 지연(0) < 대기(1) < 진행(2) < 완료(3)', () => {
    assert.equal(T.orderPriorityRank(order('p', 'pending', 5), NOW), 1);
    assert.equal(T.orderPriorityRank(order('a', 'approved', 5), NOW), 2);
    assert.equal(T.orderPriorityRank(order('c', 'completed', 5), NOW), 3);
});

test('테스트 데이터는 기본 제외, 포함 옵션 시에만 표시된다', () => {
    const orders = [
        { id: 'r1', status: 'pending', client: '가나상사', dueDate: '2026-09-10', updatedAt: NOW },
        { id: 't1', status: 'pending', client: 'TEST_샘플거래처', dueDate: '2026-09-10', updatedAt: NOW }
    ];
    const excluded = T.sortRecentOrders(orders, { includeCompleted: true, nowMs: NOW });
    assert.equal(excluded.length, 1, '테스트 데이터는 기본 제외');
    assert.equal(excluded[0].id, 'r1');
    const included = T.sortRecentOrders(orders, { includeCompleted: true, includeTest: true, nowMs: NOW });
    assert.equal(included.length, 2, '포함 옵션 시 표시');
});

test('테스트 데이터 식별(TEST_/테스트/샘플/명시 플래그)', () => {
    assert.equal(T.isTestOrder({ client: 'TEST_거래처' }), true);
    assert.equal(T.isTestOrder({ title: '테스트 주문' }), true);
    assert.equal(T.isTestOrder({ client: '샘플상사' }), true);
    assert.equal(T.isTestOrder({ isTest: true }), true);
    assert.equal(T.isTestOrder({ client: '정상거래처' }), false);
    assert.equal(T.isTestOrder(null), false);
});

test('빈 입력·비배열도 안전하게 처리한다', () => {
    // vm 컨텍스트 배열은 테스트 realm 과 prototype 이 달라 deepEqual 대신 길이로 검증
    const a = T.sortRecentOrders(null, { nowMs: NOW });
    const b = T.sortRecentOrders(undefined, {});
    assert.equal(a.length, 0);
    assert.equal(b.length, 0);
});
