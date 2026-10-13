import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ui = readFileSync(new URL("../js/business-documents.js", import.meta.url), "utf8");
const client = readFileSync(new URL("../js/business-document-client.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../business-documents.css", import.meta.url), "utf8");
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

test("회계 검토자는 활성 회계·관리자 역할만 화면과 저장 검증을 통과한다", () => {
  assert.match(ui, /\["accounting", "admin"\]\.includes\(u\.role\)/);
  assert.match(client, /directoryUser\.status === "active"/);
  assert.doesNotMatch(client, /collection\("users"\)\.doc\(item\.id\)\.get/);
  assert.match(client, /\["accounting", "admin"\]\.includes\(users\[0\]\.role\)/);
  assert.match(rules, /businessApproverValid\(d\.approverUids\[0\].*\["accounting", "admin"\]\)/s);
});

test("임시저장·이탈 경고·필수 오류 포커스를 제공한다", () => {
  assert.match(ui, /scheduleAutosave\(delay = 45000\)/);
  assert.match(ui, /beforeunload/);
  assert.match(ui, /저장 중…/);
  assert.match(ui, /저장 완료/);
  assert.match(ui, /저장 실패/);
  assert.match(ui, /function validateVisibleForm/);
  assert.match(ui, /scrollIntoView/);
  assert.match(ui, /aria-invalid/);
  assert.match(css, /\.yb-required/);
  assert.match(css, /\.yb-field-error/);
});

test("보완 요청은 제출본을 보존하고 작성자 재제출만 허용한다", () => {
  assert.match(client, /data\.action === "requestChanges"/);
  assert.match(client, /collection\("revisions"\)/);
  assert.match(client, /data\.action === "resubmit"/);
  assert.match(rules, /h\.action == "requestChanges"/);
  assert.match(rules, /h\.action == "resubmit"/);
  assert.match(rules, /allow create: if businessRevisionCreateValid/);
  assert.match(rules, /allow update, delete: if false/);
});

test("ERP 생성·재다운로드·완료·취소·재처리를 분리한다", () => {
  for (const action of ["generateErp", "confirmErp", "cancelErp", "retryErp"])
    assert.match(client, new RegExp(`action === "${action}"`));
  assert.match(ui, /동일 파일 재다운로드/);
  assert.match(ui, /ERP 이관 완료 확인/);
  assert.match(ui, /ERP 이관 취소 사유/);
  assert.match(ui, /ERP 재처리 시작/);
  assert.match(client, /erpExportSnapshot/);
  assert.match(client, /erpExportHash/);
  assert.match(rules, /businessErpSnapshotValid/);
});

test("첨부 미리보기·검색·알림·요약본과 상세본을 제공한다", () => {
  assert.match(ui, /yb-file-previews/);
  assert.match(ui, /application\/pdf/);
  assert.match(ui, /ybSearch/);
  assert.match(ui, /ybStatusFilter/);
  assert.match(ui, /ybErpFilter/);
  assert.match(ui, /ybPaymentFilter/);
  assert.match(ui, /ybDateBasis/);
  assert.match(ui, /pageSize: 20/);
  assert.match(ui, /ybPager/);
  assert.match(ui, /readAllNotifications/);
  assert.match(ui, /A4 요약본 인쇄 \/ PDF/);
  assert.match(ui, /상세 이력본 인쇄 \/ PDF/);
  assert.match(ui, /용진FLOW에서 전자승인된 사내 문서/);
  assert.match(css, /#ybPrint\.is-detail/);
});
