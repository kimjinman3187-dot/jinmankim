import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '..', 'index.html'), 'utf8');
const docs = fs.readFileSync(path.join(here, '..', 'js', 'business-documents.js'), 'utf8');

test('role defaults open each PC job workspace', () => {
  assert.match(html, /admin: 'dashboard', sales: 'sales', accounting: 'accounting', factory: 'factory'/);
});

test('mobile document workflow is not introduced', () => {
  assert.doesNotMatch(html, /mobileBusinessDocumentsMount|section-docbox/);
  assert.doesNotMatch(html, /mountBusinessDocuments/);
});

test('unfinished inventory and invite previews stay hidden', () => {
  assert.match(html, /id="pc-tab-inventory" aria-hidden="true" class="pc-tab-btn hidden yj-unfinished-feature/);
  assert.match(html, /id="pcAdminInviteCodePanel" aria-hidden="true" class="hidden yj-unfinished-feature/);
  const pcRoles = html.match(/const PC_ROLE_TABS = \{([\s\S]*?)\n\};/)?.[1] || '';
  assert.doesNotMatch(pcRoles, /inventory/);
});

test('payment work is hidden outside accounting and admin roles', () => {
  assert.ok(docs.includes("paymentTab.hidden = !finance"));
  assert.ok(docs.includes("paymentMetric.hidden = !finance"));
  assert.ok(docs.includes('if (!finance && state.view === "payments") state.view = "my"'));
});

test('visible document UI avoids implementation vocabulary and uses one release', () => {
  assert.doesNotMatch(html, /기존 document_approval_requests 기록/);
  assert.doesNotMatch(html, /Firestore 생성은|Firestore 컬렉션/);
  assert.doesNotMatch(html, /v2.0.4/);
  assert.match(html, /v2.2.0/);
  assert.doesNotMatch(html, /v2.1/);
  assert.match(docs, /표준 문서 업무/);
});
