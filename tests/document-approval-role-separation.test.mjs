import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function includes(pattern, message) {
  assert.match(html, pattern, message);
}

function roleTabs(role) {
  const match = html.match(new RegExp(`${role}: \\[([^\\]]+)\\]`, 'g'));
  assert.ok(match?.length, `${role} role tabs must exist`);
  const pcMatch = match.find(value => value.includes("'documents'"));
  assert.ok(pcMatch, `${role} PC tabs must include documents`);
  return [...pcMatch.matchAll(/'([^']+)'/g)].map(item => item[1]);
}

test('01 PC navigation exposes LIVE first', () => {
  assert.ok(html.indexOf('id="pc-tab-dashboard"') < html.indexOf('id="pc-tab-documents"'));
});
test('02 PC navigation exposes documents before sales', () => {
  assert.ok(html.indexOf('id="pc-tab-documents"') < html.indexOf('id="pc-tab-sales"'));
});
test('03 PC navigation preserves the required tail order', () => {
  const ids = ['sales', 'accounting', 'receivables', 'factory', 'inventory'].map(id => html.indexOf(`id="pc-tab-${id}"`));
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
});
test('04 documents page exists once', () => {
  assert.equal((html.match(/id="pc-page-documents"/g) || []).length, 1);
});
test('05 documents menu exists once', () => {
  assert.equal((html.match(/id="pc-tab-documents"/g) || []).length, 1);
});
test('06 employee request panel exists once', () => {
  assert.equal((html.match(/id="pcEmployeeDocumentRequestPanel"/g) || []).length, 1);
});
test('07 employee request panel is moved, not copied', () => {
  includes(/employeeDocumentMount\.appendChild\(pcEmployeeDocumentRequestPanel\)/);
});
test('08 employee request mount belongs to documents page', () => {
  const pageStart = html.indexOf('id="pc-page-documents"');
  const pageEnd = html.indexOf('id="pc-page-sales"', pageStart);
  const mount = html.indexOf('id="pcEmployeeDocumentRequestMount"');
  assert.ok(pageStart < mount && mount < pageEnd);
});
test('09 admin can access dashboard and documents', () => {
  assert.deepEqual(roleTabs('admin').slice(0, 2), ['dashboard', 'documents']);
});
test('10 sales defaults to documents and cannot access dashboard', () => {
  const tabs = roleTabs('sales');
  assert.equal(tabs[0], 'documents');
  assert.ok(!tabs.includes('dashboard'));
});
test('11 accounting defaults to documents and cannot access dashboard', () => {
  const tabs = roleTabs('accounting');
  assert.equal(tabs[0], 'documents');
  assert.ok(!tabs.includes('dashboard'));
});
test('12 factory defaults to documents and cannot access dashboard', () => {
  const tabs = roleTabs('factory');
  assert.equal(tabs[0], 'documents');
  assert.ok(!tabs.includes('dashboard'));
});
test('13 role defaults match the separation contract', () => {
  includes(/ROLE_DEFAULT_PC_TAB\s*=\s*\{\s*admin:\s*'dashboard',\s*sales:\s*'documents',\s*accounting:\s*'documents',\s*factory:\s*'documents'\s*\}/);
});
test('14 documents maps to its own access area', () => {
  includes(/documents:\s*'documents'/);
});
test('15 non-admin view contracts omit LIVE and dashboard', () => {
  for (const role of ['sales', 'accounting', 'factory']) {
    const block = html.match(new RegExp(`${role}: \\{\\s*view: \\[([^\\]]+)\\]`))?.[1] || '';
    assert.ok(!block.includes("'live'") && !block.includes("'dashboard'"), `${role} must not view LIVE`);
  }
});
test('16 all active roles can view documents', () => {
  for (const role of ['admin', 'sales', 'accounting', 'factory']) {
    const block = html.match(new RegExp(`${role}: \\{\\s*view: \\[([^\\]]+)\\]`))?.[1] || '';
    assert.ok(block.includes("'documents'"), `${role} must view documents`);
  }
});
test('17 #documents resolves to documents', () => {
  includes(/'#documents':\s*'documents'/);
});
test('18 legacy #document-approval resolves to documents', () => {
  includes(/'#document-approval':\s*'documents'/);
});
test('19 authorized URL hash has first restoration priority', () => {
  includes(/return hashTab \|\| savedTab \|\| getDefaultPCTab\(role\)/);
});
test('20 unauthorized saved PC tab is rejected', () => {
  includes(/getAuthorizedPCTab\(sessionStorage\.getItem\('active_tab'\), role\)/);
});
test('21 login uses the resolved authorized PC tab', () => {
  includes(/const initialTab = resolveInitialPCTab\(\);[\s\S]*?switchPCTab\(initialTab, false\)/);
});
test('22 switchPCTab fails closed to the role default', () => {
  includes(/if \(!allowedTabs\.includes\(tabId\) \|\| !canView\(area\)\) \{\s*tabId = getDefaultPCTab\(\)/);
});
test('23 popstate routes PC requests through access enforcement', () => {
  includes(/if \(window\.innerWidth > 768\) switchPCTab\(event\.state\.tab, false\)/);
});
test('24 documents entry refreshes employee requests', () => {
  includes(/if \(tabId === 'documents' && currentUser && isUserActive\(currentUser\)\) \{\s*window\.YJEmployeeDocumentRequests\?\.refresh\?\.\(\)/);
});
test('25 dashboard entry no longer refreshes employee requests', () => {
  assert.doesNotMatch(html, /tabId === 'dashboard' && currentUser && isUserActive\(currentUser\)[\s\S]{0,100}YJEmployeeDocumentRequests/);
});
test('26 every literal DOM id remains unique', () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert.deepEqual(duplicates, []);
});
test('27 mobile role tab definitions remain unchanged', () => {
  includes(/const ROLE_TABS = \{\s*sales: \['sales', 'receivables', 'factory', 'history'\],\s*accounting: \['sales', 'accounting', 'receivables', 'factory', 'history'\],\s*factory: \['factory'\],\s*admin: \['sales', 'accounting', 'receivables', 'factory', 'history'\]\s*\}/);
});
