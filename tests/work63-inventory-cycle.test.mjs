import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const moduleSource = readFileSync(new URL('../js/production-inventory.js', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

test('WORK63 exposes a guided allocation, shipment, return, and correction workflow', () => {
  assert.match(html, /재고 순환 처리/);
  assert.match(html, /id="inventoryAllocationCreatePanel"/);
  assert.match(html, /id="inventoryAllocationList"/);
  assert.match(html, /id="inventoryShipmentList"/);
  assert.match(html, /재고 실사·오입력 정정/);
  assert.match(moduleSource, /allocateOrder/);
  assert.match(moduleSource, /shipAllocation/);
  assert.match(moduleSource, /releaseAllocation/);
  assert.match(moduleSource, /returnShipment/);
  assert.match(moduleSource, /adjustStock/);
});
test('WORK63 distinguishes physical, reserved, and available inventory', () => {
  assert.match(html, />현재 재고</);
  assert.match(html, />주문 예약</);
  assert.match(html, />출고 가능</);
  assert.match(moduleSource, /availableQty: afterQty - afterReservedQty/);
  assert.match(moduleSource, /reservedQty: afterReservedQty/);
});

test('WORK63 writes every cycle transition through a Firestore transaction and immutable movement', () => {
  assert.match(moduleSource, /db\.runTransaction/g);
  assert.match(moduleSource, /movementType: 'allocation'/);
  assert.match(moduleSource, /movementType: action/);
  assert.match(moduleSource, /movementType: 'stock_adjustment'/);
  assert.match(rules, /function inventoryCycleMovementValid/);
  assert.match(rules, /function inventoryAllocationCreateValid/);
  assert.match(rules, /function inventoryAllocationUpdateValid/);
  assert.match(rules, /match \/allocations\/\{allocationId\}/);
  assert.match(rules, /allow update, delete: if false/);
});
