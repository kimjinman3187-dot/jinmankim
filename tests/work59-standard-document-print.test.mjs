import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ui = readFileSync(new URL("../js/business-documents.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../business-documents.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("표준문서 인쇄물은 화면 복제가 아닌 독립 A4 문서로 구성된다", () => {
  assert.match(ui, /function buildPrintDocument\(r\)/);
  assert.doesNotMatch(ui, /\$\("ybDetail"\)\.cloneNode/);
  assert.match(ui, /문서 기본정보/);
  assert.match(ui, /결재 내용/);
  assert.match(ui, /첨부 내역/);
  assert.match(ui, /결재·처리 이력/);
});

test("담당자·검토자·최종승인자의 서명 또는 전자결재 상태를 출력한다", () => {
  assert.match(ui, /결재 서명란/);
  assert.match(ui, /서명\/도장/);
  assert.match(ui, /전자제출/);
  assert.match(ui, /전자승인/);
  assert.match(ui, /yb-signature-mark/);
  assert.match(css, /\.yb-signature-mark\.is-approved/);
});

test("결재선 미지정 문서도 문서 종류별 표준 서명칸을 유지한다", () => {
  assert.match(ui, /document\.kind === "expense"/);
  assert.match(ui, /\["회계 검토", "최종 승인"\]/);
  assert.match(ui, /\["최종 승인"\]/);
  assert.match(ui, /name: name \|\| "미지정"/);
});

test("인쇄 DOM을 두 프레임 렌더링한 뒤 인쇄하여 흰 종이 회귀를 막는다", () => {
  assert.match(ui, /requestAnimationFrame\(\(\) =>\s*requestAnimationFrame/);
  assert.match(css, /body\.yb-printing > #ybPrint/);
  assert.match(css, /#ybPrint,\s*#ybPrint \*/);
  assert.match(css, /size:\s*A4/);
});

test("WORK59 인쇄 서식 자산은 새 캐시 버전을 사용한다", () => {
  assert.match(html, /business-documents\.css\?v=20261008-work59/);
  assert.match(html, /business-documents\.js\?v=20261008-work59b/);
});
