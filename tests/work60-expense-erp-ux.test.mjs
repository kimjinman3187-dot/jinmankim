import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ui = readFileSync(new URL("../js/business-documents.js", import.meta.url), "utf8");
const client = readFileSync(new URL("../js/business-document-client.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../business-documents.css", import.meta.url), "utf8");
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("지출결의서는 칩·관련문서 토글·드래그 첨부로 인지 복잡도를 낮춘다", () => {
  assert.match(ui, /function chipField/);
  assert.match(ui, /yb-related/);
  assert.match(ui, /\+ 관련 문서 추가/);
  assert.match(ui, /yb-file-drop/);
  assert.match(ui, /dataTransfer\.files/);
  assert.match(css, /\.yb-chip input:checked \+ span/);
  assert.match(css, /\.yb-file-drop\.is-dragging/);
});

test("과세·면세·영세에 따라 총액과 공급가액을 양방향 계산한다", () => {
  assert.match(ui, /Math\.round\(totalValue \/ 1\.1\)/);
  assert.match(ui, /Math\.round\(supplyValue \* 0\.1\)/);
  assert.match(ui, /tax\.disabled = taxType !== "taxable"/);
  assert.match(client, /out\.taxType = choice/);
  assert.match(client, /out\.taxType === "taxable" \|\| out\.taxAmount === 0/);
});

test("일반 기안자 DOM에서는 회계 처리 유형과 지급 정보가 제외된다", () => {
  assert.match(ui, /key === "settlementType" && !isFinance\(\)/);
  assert.match(ui, /d\.kind === "expense" && finance/);
  assert.match(ui, /action: "classifyExpense"/);
});

test("더존 CSV는 UTF-8 BOM을 포함하고 JSON과 같은 승인 데이터를 사용한다", () => {
  assert.match(ui, /"\\uFEFF"/);
  assert.match(ui, /new Blob\(\[csv\]/);
  assert.match(ui, /JSON\.stringify\(record, null, 2\)/);
  assert.match(ui, /_DOUZONE\.\$\{format\}/);
});

test("ERP 이관은 서버시간과 Rules 잠금으로 한 번만 기록한다", () => {
  assert.match(client, /erpExportedAt: serverTime\(\)/);
  assert.match(client, /erpExportedBy: user\.uid/);
  assert.match(client, /document\.erpExportStatus \|\| "ready"/);
  assert.match(rules, /h\.action == "exportErp"/);
  assert.match(rules, /od\.get\("erpExportStatus", "ready"\) == "ready"/);
  assert.match(rules, /nd\.erpExportedAt == request\.time/);
});

test("WORK60 자산은 새 캐시 버전을 사용한다", () => {
  assert.match(html, /business-documents\.css\?v=20261009-work60/);
  assert.match(html, /business-documents\.js\?v=20261009-work60/);
});
