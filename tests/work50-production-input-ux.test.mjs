import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const legacy = readFileSync(new URL("../js/work22-3h3i-finance-enhancement.js", import.meta.url), "utf8");

test("WORK50 PC exposes quick production entry and card entry", () => {
  assert.match(html, /id="pcProductionQuickOrder"/);
  assert.match(html, /id="pcProductionQuickQty"/);
  assert.match(html, /submitPCQuickProduction/);
  assert.match(html, /placeholder="이번 생산수량"/);
  assert.match(html, /생산수량 등록/);
});

test("WORK50 production renderer is no longer overwritten by the legacy patch", () => {
  assert.doesNotMatch(legacy, /patchedUpdatePCProductionCards/);
  assert.doesNotMatch(legacy, /renderEnhancedProductionList/);
  assert.match(legacy, /생산 화면은 index\.html의 단일 렌더러/);
});

test("WORK50 filters have labels, reset, and a useful empty state", () => {
  assert.match(html, />검색<input id="pcProductionSearch"/);
  assert.match(html, />납기<select id="pcProductionDueFilter"/);
  assert.match(html, />생산 단계<select id="pcProductionStageFilter"/);
  assert.match(html, /resetPCProductionFilters/);
  assert.match(html, /현재 필터 조건에 맞는 생산 주문이 없습니다/);
  assert.match(html, /현재 생산 가능한 승인 주문이 없습니다/);
});

test("WORK50 uses all loaded orders for operational production visibility", () => {
  assert.match(html, /const productionMetrics = getPCDashboardMetrics\(Array\.isArray\(orders\) \? orders : filteredOrders\)/);
});

test("WORK50 shows the production stage rail and prevents duplicate submits", () => {
  assert.match(html, /function renderProductionStageRail/);
  assert.match(html, /actionButton\.disabled = true/);
  assert.match(html, /등록 중…/);
  assert.match(html, /return true/);
});

test("WORK50 keeps mobile quantity entry simple and explains empty state", () => {
  assert.match(html, /id="productionMobileMessage"/);
  assert.match(html, /품질·포장·출고 처리는 PC에서 진행합니다/);
  assert.match(html, /inputmode="numeric" id="in-\$\{o\.id\}"/);
  assert.match(html, />등록<\/button>/);
});
