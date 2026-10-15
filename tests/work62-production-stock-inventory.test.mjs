import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const moduleSource = readFileSync(new URL('../js/production-inventory.js', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const legacyHotfix = readFileSync(new URL('../js/work22-payment-hotfix.js', import.meta.url), 'utf8');

test('WORK62 separates order production and finished-goods stock production', () => {
  assert.match(html, /재고 확보 생산/);
  assert.match(html, /id="stockProductionCreatePanel"/);
  assert.match(html, /id="stockProductionList"/);
  assert.match(moduleSource, /db\.collection\('production_inventory'\)\.doc\('main'\)/);
  assert.match(moduleSource, /inventoryRoot\(\)\.collection\('jobs'\)/);
  assert.match(moduleSource, /productionType: 'stock'/);
});

test('WORK62 only increases inventory through an atomic production receipt', () => {
  assert.match(moduleSource, /db\.runTransaction/);
  assert.match(moduleSource, /inventoryRoot\(\)\.collection\('items'\)/);
  assert.match(moduleSource, /movementsCollection\(\)\.doc\(id\)/);
  assert.match(moduleSource, /movementType: 'production_receipt'/);
  assert.match(moduleSource, /if \(movementSnapshot\.exists\)/);
  assert.match(moduleSource, /productionStage: 'stocked'/);
});

test('WORK62 makes the inventory screen operational instead of an unfinished shell', () => {
  assert.doesNotMatch(html, /id="pc-tab-inventory"[^>]*yj-unfinished-feature/);
  assert.doesNotMatch(html, />UI SHELL</);
  assert.match(html, /id="pcInventoryMovementList"/);
  assert.match(html, /생산입고 원장 연결/);
  assert.doesNotMatch(legacyHotfix, /Inventory <span class="yj-inventory-beta-badge"/);
  assert.doesNotMatch(legacyHotfix, /표시 전용 Beta 화면/);
  assert.match(moduleSource, /availableQty\(item\) <= 0/);
  assert.match(moduleSource, /qty > 0 && qty <= Number\(item\.safetyStock \|\| 0\)/);
});

test('WORK62 applies the test-data toggle to production chart and material summary', () => {
  assert.match(html, /yjExcludeTest\(filteredOrders\)\.forEach/);
  assert.match(html, /yjExcludeTest\(orders \|\| \[\]\)\.forEach/);
  assert.match(html, /window\.YJProductionInventory\?\.refresh\?\.\(\)/);
});

test('WORK62 renders final order and stock stages as completed', () => {
  assert.match(html, /const complete = stage === 'shipped' \|\| index < current/);
  assert.match(moduleSource, /const complete = stage === 'stocked' \|\| index < current/);
});

test('WORK62 limits production and inventory writes in Firestore Rules', () => {
  assert.match(rules, /function arIsProductionStaff\(\)/);
  assert.match(rules, /function arIsProductionManager\(\)/);
  assert.match(rules, /match \/production_inventory\/main/);
  assert.match(rules, /match \/jobs\/\{jobId\}/);
  assert.match(rules, /match \/items\/\{itemCode\}/);
  assert.match(rules, /match \/movements\/\{movementId\}/);
  assert.match(rules, /productionReceiptMovementValid/);
  assert.match(rules, /stockReceiptBound/);
});
