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

test('재고 화면은 처음 보는 사용자도 이해할 수 있는 업무 용어를 사용한다', () => {
  assert.match(html, /현재 재고에서 주문 예약 수량을 빼면 출고 가능 수량입니다/);
  assert.match(html, /최근 수량 변경 내역/);
  assert.match(html, /모바일에서는 수량만 확인할 수 있습니다/);
  assert.match(productionInventory, /현재 재고/);
  assert.match(productionInventory, /주문 예약/);
  assert.match(productionInventory, /출고 가능/);
  assert.match(productionInventory, /생산 완료 입고/);
  assert.match(productionInventory, /재고 수량 수정/);
});

test('운영 검증 자료는 실제 품목처럼 보이지 않도록 표시한다', () => {
  assert.match(productionInventory, /function isTestInventoryRecord\(record\)/);
  assert.match(productionInventory, /테스트용 완제품/);
  assert.match(productionInventory, /테스트 자료/);
  assert.match(productionInventory, /기능 확인용 기록/);
});

test('모바일 핵심 글자는 11px 이상으로 유지한다', () => {
  const mobileSection = html.match(/<div id="section-inventory"[\s\S]*?<div id="section-receivables"/)?.[0] || '';
  assert.doesNotMatch(mobileSection, /text-\[(?:9|10)px\]/);
  assert.doesNotMatch(productionInventory.slice(productionInventory.indexOf('function renderMobileInventory'), productionInventory.indexOf('function renderCycle')), /text-\[(?:9|10)px\]/);
});
