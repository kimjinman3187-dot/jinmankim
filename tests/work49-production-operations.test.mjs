import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const docs = readFileSync(new URL("../js/business-documents.js", import.meta.url), "utf8");

test("WORK49 production KPIs use production records instead of payment and due-date proxies", () => {
  assert.match(html, /품질 확인 대기/);
  assert.match(html, /오늘 출고/);
  assert.match(html, /o\.productionCompletedAt \|\| o\.completedAt/);
  assert.doesNotMatch(html, /const packingWaitItems = completedItems\.filter\(o => o\.paymentStatus !== 'paid'\)/);
  assert.doesNotMatch(html, /const todayDoneItems = completedItems\.filter\(o => o\.dueDate === todayStr\)/);
});

test("WORK49 renders all production orders with due and stage filters", () => {
  assert.match(html, /id="pcProductionDueFilter"/);
  assert.match(html, /id="pcProductionStageFilter"/);
  assert.match(html, /id="pcProductionSearch"/);
  assert.doesNotMatch(html, /metrics\.activeProductionItems[\s\S]{0,180}\.slice\(0, 5\)/);
});

test("WORK49 protects production quantity and stage updates with Firestore transactions", () => {
  const transactions = html.match(/db\.runTransaction/g) || [];
  assert.ok(transactions.length >= 3);
  assert.match(html, /productionHistory/);
  assert.match(html, /correctProductionQty/);
  assert.match(html, /advanceProductionStage/);
  assert.match(html, /productionStage: finished \? 'quantity_complete' : 'in_production'/);
});

test("WORK49 connects a production order to the quality exception form", () => {
  assert.match(html, /openProductionQualityException/);
  assert.match(docs, /function openQualityException\(order\)/);
  assert.match(docs, /type\.value = "quality"/);
  assert.match(docs, /openQualityException,/);
});
