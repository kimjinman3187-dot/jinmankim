import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ui = readFileSync("js/business-documents.js", "utf8");
const css = readFileSync("business-documents.css", "utf8");
const index = readFileSync("index.html", "utf8");

test("attachment state is announced and distinguishes selected files from saved files", () => {
  assert.match(ui, /id="ybAttachmentState"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(ui, /저장 전 · \$\{selected\.length\}개/);
  assert.match(ui, /선택한 파일은 아직 저장 전입니다/);
  assert.match(ui, /저장·무결성 확인 완료/);
  assert.match(ui, /재업로드 필요/);
});

test("only completed attachments can be downloaded", () => {
  assert.match(ui, /d\.attachmentCompletion\?\.\[slot\] === true/);
  assert.match(ui, /attachmentButton\.disabled = !ready/);
  assert.match(ui, /다운로드 시 SHA-256 무결성을 검증합니다/);
  assert.match(ui, /업로드를 완료해야 다운로드할 수 있습니다/);
});

test("approval request validates expense evidence and incomplete persisted attachments", () => {
  assert.match(ui, /type\.value === "expense" &&\s*effectiveAttachmentCount === 0/);
  assert.match(ui, /지출결의서는 증빙 첨부를 저장한 후 결재 요청하세요/);
  assert.match(ui, /!replaceAttachments &&\s*!existingAttachmentsReady/);
  assert.match(ui, /모든 첨부의 저장 완료를 확인한 후 결재 요청할 수 있습니다/);
});

test("responsive attachment UI and work56 cache busting are present", () => {
  assert.match(css, /\.yb-attachment-state/);
  assert.match(css, /\.yb-attachment-panel/);
  assert.match(css, /\.yb-attachment-item/);
  assert.match(index, /business-documents\.css\?v=20261008-work56/);
  assert.match(index, /business-documents\.js\?v=20261008-work56/);
});

test("document details remain printable on A4 or to PDF", () => {
  assert.match(ui, /A4 인쇄 \/ PDF/);
  assert.match(ui, /yb-print-attachment/);
  assert.match(ui, /window\.print\(\)/);
  assert.match(css, /@page\s*\{\s*size: A4;/);
});
