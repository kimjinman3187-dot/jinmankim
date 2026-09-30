"use strict";
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const req = createRequire(path.join(__dirname, "../tests/rules/package.json"));
const { initializeTestEnvironment, assertFails, assertSucceeds } = req("@firebase/rules-unit-testing");
const { doc, setDoc, getDoc, writeBatch, serverTimestamp } = req("firebase/firestore");
let env;
const token = { firebase: { sign_in_provider: "google.com" } };

function documentData(operationId) {
  return {
    schemaVersion: 5, clientMode: "spark", kind: "general", number: "YJ-GENERAL-20260930-ABC123",
    details: { title: "무료 요금제 문서", reason: "복구 검증", effectiveDate: "2026-10-01", amount: 0 },
    requesterUid: "rules-employee", requesterName: "직원", requesterRole: "sales",
    approverUids: ["rules-admin"], approverNames: ["대표"], status: "draft", step: 0,
    attachments: {}, attachmentCount: 0, attachmentsTotalSize: 0,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), submittedAt: null, approvedAt: null, rejectionReason: "",
    paidAmount: 0, paymentStatus: null, settledAt: null, completedAt: null, allocatedAmount: 0,
    purchaseReserved: false, revisedFrom: "", lastOperationId: operationId,
  };
}
function history(operationId, action, actorUid, actorName, actorRole, previousStatus, nextStatus, reason = "") {
  return { operationId, action, actorUid, actorName, actorRole, at: serverTimestamp(), reason, previousStatus, nextStatus };
}
async function createDocument(id = "rules-document") {
  const db = env.authenticatedContext("rules-employee", token).firestore();
  const batch = writeBatch(db); const operationId = "create-operation-0001";
  batch.set(doc(db, "business_documents/" + id), documentData(operationId));
  batch.set(doc(db, "business_documents/" + id + "/history/" + operationId), history(operationId, "create", "rules-employee", "직원", "sales", "none", "draft"));
  await assertSucceeds(batch.commit());
}

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-yj-documents",
    firestore: { host: "127.0.0.1", port: 8185, rules: fs.readFileSync(path.join(__dirname, "../firestore.rules"), "utf8") },
  });
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, "users/rules-admin"), { role: "admin", name: "대표", status: "active" });
    await setDoc(doc(db, "users/rules-employee"), { role: "sales", name: "직원", status: "active" });
    await setDoc(doc(db, "users/rules-outsider"), { role: "sales", name: "외부 직원", status: "active" });
    await setDoc(doc(db, "business_approver_directory/rules-admin"), { role: "admin", name: "대표", status: "active" });
  });
});
test.after(async () => { await env?.cleanup(); });
test("Spark 문서는 본문과 create 이력을 같은 배치로 생성한다", async () => {
  const id = "rules-document-read"; await createDocument(id);
  const employee = env.authenticatedContext("rules-employee", token).firestore();
  const admin = env.authenticatedContext("rules-admin", token).firestore();
  const outsider = env.authenticatedContext("rules-outsider", token).firestore();
  await assertSucceeds(getDoc(doc(employee, "business_documents/" + id)));
  await assertSucceeds(getDoc(doc(admin, "business_documents/" + id)));
  await assertFails(getDoc(doc(outsider, "business_documents/" + id)));
});
test("이력 없는 문서 생성과 문서 없는 이력 생성을 거부한다", async () => {
  const db = env.authenticatedContext("rules-employee", token).firestore();
  await assertFails(setDoc(doc(db, "business_documents/orphan-document"), documentData("create-operation-0002")));
  await assertFails(setDoc(doc(db, "business_documents/missing/history/create-operation-0003"), history("create-operation-0003", "create", "rules-employee", "직원", "sales", "none", "draft")));
});
test("작성자 제출과 지정 관리자 승인을 원자적 이력으로 처리한다", async () => {
  const id = "rules-document-flow"; await createDocument(id);
  const employee = env.authenticatedContext("rules-employee", token).firestore();
  const submit = writeBatch(employee); const submitId = "submit-operation-0001";
  submit.update(doc(employee, "business_documents/" + id), { status: "pending", submittedAt: serverTimestamp(), updatedAt: serverTimestamp(), lastOperationId: submitId });
  submit.set(doc(employee, "business_documents/" + id + "/history/" + submitId), history(submitId, "submit", "rules-employee", "직원", "sales", "draft", "pending"));
  await assertSucceeds(submit.commit());
  const admin = env.authenticatedContext("rules-admin", token).firestore();
  const approve = writeBatch(admin); const approveId = "approve-operation-0001";
  approve.update(doc(admin, "business_documents/" + id), { status: "approved", step: 0, approvedAt: serverTimestamp(), updatedAt: serverTimestamp(), lastOperationId: approveId });
  approve.set(doc(admin, "business_documents/" + id + "/history/" + approveId), history(approveId, "approve", "rules-admin", "대표", "admin", "pending", "approved"));
  await assertSucceeds(approve.commit());
});
test("상태 위조·자기 승인·지급 하위컬렉션 쓰기를 거부한다", async () => {
  const id = "rules-document-forge"; await createDocument(id);
  const employee = env.authenticatedContext("rules-employee", token).firestore();
  await assertFails(setDoc(doc(employee, "business_documents/" + id), { status: "approved" }, { merge: true }));
  await assertFails(setDoc(doc(employee, "business_documents/" + id + "/payments/pay-1"), { amount: 1 }));
  const outsider = env.authenticatedContext("rules-outsider", token).firestore();
  await assertFails(setDoc(doc(outsider, "business_approver_directory/fake"), { role: "admin", name: "위조", status: "active" }));
});
