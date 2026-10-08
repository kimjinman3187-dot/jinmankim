import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const client = readFileSync("js/business-document-client.js", "utf8");
const ui = readFileSync("js/business-documents.js", "utf8");
const rules = readFileSync("firestore.rules", "utf8");
const html = readFileSync("index.html", "utf8");

test("회계·관리자의 지급 기록과 정산 기능을 노출한다", () => {
  assert.match(ui, /const finance = isFinance\(\)/);
  assert.match(client, /async function preparePayment/);
  assert.match(client, /async function recordPayment/);
  assert.match(client, /data\.action === "settle"/);
  assert.match(ui, /지급 기록을 저장했습니다\. 실제 송금은 별도입니다/);
});

test("지급 증빙은 Firestore 분할 저장과 SHA-256 검증을 사용한다", () => {
  assert.match(client, /uploadPaymentProof/);
  assert.match(client, /proof_chunks/);
  assert.match(client, /proof_upload/);
  assert.match(client, /지급 증빙 무결성 검증에 실패했습니다/);
  assert.match(rules, /businessPaymentManifestCreateValid/);
});

test("이체번호 중복 차단과 지급 상한을 강제한다", () => {
  assert.match(client, /business_payment_references/);
  assert.match(client, /paidAmount <= document\.details\.amount/);
  assert.match(rules, /businessPaymentRecordedValid/);
  assert.match(rules, /match \/business_payment_references\/\{reference\}/);
});

test("문서 알림은 수신자별로 저장·읽음 처리한다", () => {
  assert.match(client, /business_document_notifications/);
  assert.match(client, /recipientUid/);
  assert.match(client, /markNotificationRead/);
  assert.match(rules, /resource\.data\.recipientUid == request\.auth\.uid/);
  assert.match(ui, /계정별로 따로 읽음 처리됩니다/);
});

test("거래처·계약조건 승인서를 정식 양식으로 검증한다", () => {
  assert.match(ui, /vendor_contract: "거래처·계약조건 승인서"/);
  assert.match(client, /kind === "vendor_contract"/);
  assert.match(rules, /kind == "vendor_contract"/);
  assert.match(rules, /businessText\(d\.paymentTerms, 1, 500\)/);
});

test("지급 모달 ID는 취소·정정 간 중복되지 않는다", () => {
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
  assert.deepEqual(ids.filter((id, index) => ids.indexOf(id) !== index), []);
  assert.match(html, /paymentCancelReason/);
  assert.match(html, /paymentCorrReason/);
});
