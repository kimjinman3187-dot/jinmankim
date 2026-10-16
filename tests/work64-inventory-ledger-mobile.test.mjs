import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const productionInventory = readFileSync(resolve(root, 'js/production-inventory.js'), 'utf8');

test('PC 재고 이동 원장 렌더 결과를 실제 DOM에 반영한다', () => {
  assert.match(productionInventory, /movementList\.innerHTML\s*=\s*inventoryMovements\.length/);
});

test('모바일 재고 카테고리와 조회 전용 화면이 연결된다', () => {
  assert.match(html, /id="section-inventory"/);
  assert.match(html, /id="mobileInventorySummary"/);
  assert.match(html, /id="mobileInventoryItems"/);
  assert.match(html, /id="mobileInventoryMovements"/);
  assert.match(html, /factory:\s*\['factory',\s*'inventory'\]/);
  assert.match(html, /factory_manager:\s*\['factory',\s*'inventory'\]/);
  assert.match(html, /admin:\s*\['sales',\s*'accounting',\s*'receivables',\s*'factory',\s*'inventory',\s*'history'\]/);
  assert.match(html, /sales:\s*\['sales',\s*'receivables',\s*'factory',\s*'history'\]/);
  assert.match(html, /accounting:\s*\['sales',\s*'accounting',\s*'receivables',\s*'factory',\s*'history'\]/);
  assert.match(html, /inventory:\s*\{label:'재고'\}/);
});

test('모바일 재고 화면은 공통 Firestore 스냅샷으로 갱신된다', () => {
  assert.match(productionInventory, /function renderMobileInventory\(\)/);
  assert.match(productionInventory, /renderMobileInventory\(\);\s*\n\s*renderCycle\(\);/);
  assert.match(html, /tabId === 'inventory'\) window\.YJProductionInventory\?\.refresh\?\.\(\)/);
});
