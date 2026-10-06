"use strict";
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const req = createRequire(path.join(__dirname, "../tests/rules/package.json"));
const { initializeTestEnvironment, assertFails, assertSucceeds } = req("@firebase/rules-unit-testing");
const { Bytes, doc, setDoc, getDoc, writeBatch, serverTimestamp } = req("firebase/firestore");
let env;
const token = { firebase: { sign_in_provider: "google.com" } };

function documentData(operationId) {
  return {
    schemaVersion: 7, clientMode: "spark-firestore", kind: "general", number: "YJ-GENERAL-20260930-ABC123",
    details: { title: "무료 요금제 문서", reason: "복구 검증", effectiveDate: "2026-10-01", amount: 0 },
    requesterUid: "rules-employee", requesterName: "직원", requesterRole: "sales",
    approverUids: ["rules-admin"], approverNames: ["대표"], status: "draft", step: 0,
    attachments: {}, attachmentCount: 0, attachmentsTotalSize: 0,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), submittedAt: null, approvedAt: null, rejectionReason: "",
    paidAmount: 0, paymentStatus: null, settledAt: null, completedAt: null, completionNote: "", cancellationReason: "", allocatedAmount: 0,
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
async function submitAndApprove(id) {
  await createDocument(id);
  const employee = env.authenticatedContext("rules-employee", token).firestore();
  const submitId = "submit-helper-operation-0001-" + id;
  const submit = writeBatch(employee);
  submit.update(doc(employee, "business_documents/" + id), { status: "pending", submittedAt: serverTimestamp(), updatedAt: serverTimestamp(), lastOperationId: submitId });
  submit.set(doc(employee, "business_documents/" + id + "/history/" + submitId), history(submitId, "submit", "rules-employee", "직원", "sales", "draft", "pending"));
  await assertSucceeds(submit.commit());
  const admin = env.authenticatedContext("rules-admin", token).firestore();
  const approveId = "approve-helper-operation-0001-" + id;
  const approve = writeBatch(admin);
  approve.update(doc(admin, "business_documents/" + id), { status: "approved", step: 0, approvedAt: serverTimestamp(), updatedAt: serverTimestamp(), lastOperationId: approveId });
  approve.set(doc(admin, "business_documents/" + id + "/history/" + approveId), history(approveId, "approve", "rules-admin", "대표", "admin", "pending", "approved"));
  await assertSucceeds(approve.commit());
}

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-yj-documents",
    firestore: { host: "127.0.0.1", port: 8080, rules: fs.readFileSync(path.join(__dirname, "../firestore.rules"), "utf8") },
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
test("첨부 문서는 청크와 완료 매니페스트 없이는 제출할 수 없다", async () => {
  const id = "rules-document-attachment";
  const employee = env.authenticatedContext("rules-employee", token).firestore();
  const createId = "create-attachment-0001";
  const sha256 = "c".repeat(64);
  const data = documentData(createId);
  data.attachments = {
    a0: {
      name: "proof.pdf",
      size: 10,
      contentType: "application/pdf",
      chunkCount: 1,
      sha256,
      firestorePath:
        "business_documents/" + id + "/attachment_uploads/a0",
    },
  };
  data.attachmentCount = 1;
  data.attachmentsTotalSize = 10;
  const create = writeBatch(employee);
  create.set(doc(employee, "business_documents/" + id), data);
  create.set(
    doc(employee, "business_documents/" + id + "/history/" + createId),
    history(createId, "create", "rules-employee", "직원", "sales", "none", "draft"),
  );
  await assertSucceeds(create.commit());

  const submitId = "submit-attachment-0001";
  const submitWithoutFile = writeBatch(employee);
  submitWithoutFile.update(doc(employee, "business_documents/" + id), {
    status: "pending",
    submittedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastOperationId: submitId,
  });
  submitWithoutFile.set(
    doc(employee, "business_documents/" + id + "/history/" + submitId),
    history(submitId, "submit", "rules-employee", "직원", "sales", "draft", "pending"),
  );
  await assertFails(submitWithoutFile.commit());

  await assertSucceeds(
    setDoc(
      doc(employee, "business_documents/" + id + "/attachment_chunks/a0-0"),
      {
        slot: "a0",
        index: 0,
        size: 10,
        sha256,
        data: Bytes.fromUint8Array(new Uint8Array(10)),
        uploaderUid: "rules-employee",
        uploadedAt: serverTimestamp(),
      },
    ),
  );
  await assertSucceeds(
    setDoc(
      doc(employee, "business_documents/" + id + "/attachment_uploads/a0"),
      {
        ...data.attachments.a0,
        uploaderUid: "rules-employee",
        completedAt: serverTimestamp(),
      },
    ),
  );
  const submitComplete = writeBatch(employee);
  submitComplete.update(doc(employee, "business_documents/" + id), {
    status: "pending",
    submittedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastOperationId: submitId,
  });
  submitComplete.set(
    doc(employee, "business_documents/" + id + "/history/" + submitId),
    history(submitId, "submit", "rules-employee", "직원", "sales", "draft", "pending"),
  );
  await assertSucceeds(submitComplete.commit());
});
test("상태 위조·자기 승인·지급 하위컬렉션 쓰기를 거부한다", async () => {
  const id = "rules-document-forge"; await createDocument(id);
  const employee = env.authenticatedContext("rules-employee", token).firestore();
  await assertFails(setDoc(doc(employee, "business_documents/" + id), { status: "approved" }, { merge: true }));
  await assertFails(setDoc(doc(employee, "business_documents/" + id + "/payments/pay-1"), { amount: 1 }));
  const outsider = env.authenticatedContext("rules-outsider", token).firestore();
  await assertFails(setDoc(doc(outsider, "business_approver_directory/fake"), { role: "admin", name: "위조", status: "active" }));
});

test("필수값이 덜 입력된 문서를 임시저장하고 본인만 수정한다", async () => {
  const id = "rules-draft-edit";
  const employee = env.authenticatedContext("rules-employee", token).firestore();
  const createId = "create-draft-operation-0001";
  const draft = documentData(createId);
  draft.details = { title: "", reason: "", effectiveDate: "", amount: 0 };
  draft.approverUids = [];
  draft.approverNames = [];
  const create = writeBatch(employee);
  create.set(doc(employee, "business_documents/" + id), draft);
  create.set(doc(employee, "business_documents/" + id + "/history/" + createId), history(createId, "create", "rules-employee", "직원", "sales", "none", "draft"));
  await assertSucceeds(create.commit());

  const outsider = env.authenticatedContext("rules-outsider", token).firestore();
  await assertFails(setDoc(doc(outsider, "business_documents/" + id), { details: { title: "위조" } }, { merge: true }));

  const updateId = "update-draft-operation-0001";
  const update = writeBatch(employee);
  update.update(doc(employee, "business_documents/" + id), {
    details: { title: "수정 완료", reason: "결재 요청 준비", effectiveDate: "2026-10-06", amount: 0 },
    approverUids: ["rules-admin"], approverNames: ["대표"],
    updatedAt: serverTimestamp(), lastOperationId: updateId,
  });
  update.set(doc(employee, "business_documents/" + id + "/history/" + updateId), history(updateId, "updateDraft", "rules-employee", "직원", "sales", "draft", "draft"));
  await assertSucceeds(update.commit());
});

test("관리자 승인 취소와 비지출 문서 처리 완료를 이력과 함께 기록한다", async () => {
  const cancelId = "rules-approved-cancel";
  await submitAndApprove(cancelId);
  const employee = env.authenticatedContext("rules-employee", token).firestore();
  const badId = "cancel-by-requester-operation-0001";
  const bad = writeBatch(employee);
  bad.update(doc(employee, "business_documents/" + cancelId), { status: "cancelled", cancellationReason: "작성자 취소", updatedAt: serverTimestamp(), lastOperationId: badId });
  bad.set(doc(employee, "business_documents/" + cancelId + "/history/" + badId), history(badId, "cancelApproved", "rules-employee", "직원", "sales", "approved", "cancelled", "작성자 취소"));
  await assertFails(bad.commit());

  const admin = env.authenticatedContext("rules-admin", token).firestore();
  const cancelOperation = "cancel-approved-operation-0001";
  const cancel = writeBatch(admin);
  cancel.update(doc(admin, "business_documents/" + cancelId), { status: "cancelled", cancellationReason: "업무 조건 변경", updatedAt: serverTimestamp(), lastOperationId: cancelOperation });
  cancel.set(doc(admin, "business_documents/" + cancelId + "/history/" + cancelOperation), history(cancelOperation, "cancelApproved", "rules-admin", "대표", "admin", "approved", "cancelled", "업무 조건 변경"));
  await assertSucceeds(cancel.commit());

  const completeId = "rules-approved-complete";
  await submitAndApprove(completeId);
  const completeOperation = "complete-operation-0001";
  const complete = writeBatch(admin);
  complete.update(doc(admin, "business_documents/" + completeId), { completedAt: serverTimestamp(), completionNote: "업무 반영 완료", updatedAt: serverTimestamp(), lastOperationId: completeOperation });
  complete.set(doc(admin, "business_documents/" + completeId + "/history/" + completeOperation), history(completeOperation, "complete", "rules-admin", "대표", "admin", "approved", "approved", "업무 반영 완료"));
  await assertSucceeds(complete.commit());
});
