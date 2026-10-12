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
    schemaVersion: 10, clientMode: "spark-firestore", kind: "general", number: "YJ-GENERAL-20260930-ABC123",
    details: { title: "무료 요금제 문서", reason: "복구 검증", effectiveDate: "2026-10-01", amount: 0 },
    requesterUid: "rules-employee", requesterName: "직원", requesterRole: "sales",
    approverUids: ["rules-admin"], approverNames: ["대표"], status: "draft", step: 0,
    attachments: {}, attachmentCount: 0, attachmentsTotalSize: 0,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), submittedAt: null, approvedAt: null, rejectionReason: "",
    paidAmount: 0, paymentStatus: null, settledAt: null, completedAt: null, completionNote: "", cancellationReason: "", allocatedAmount: 0,
    purchaseReserved: false, revisedFrom: "", erpExportStatus: null, erpExportedAt: null, erpExportedBy: "",
    erpExportSnapshot: null, erpExportHash: "", erpExportVersion: 0, erpExportFormat: "", erpExportCreatedAt: null,
    erpExportCreatedBy: "", erpExportCreatedByName: "", erpExportConfirmedAt: null, erpExportConfirmedBy: "",
    erpExportCancelledAt: null, erpExportCancelledBy: "", erpExportCancelReason: "", erpExportRetryCount: 0,
    revision: 0, revisionReason: "", revisionRequestedAt: null, revisionRequestedBy: "", revisionSnapshotId: "",
    lastOperationId: operationId,
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
    await setDoc(doc(db, "users/rules-accounting"), { role: "accounting", name: "회계", status: "active" });
    await setDoc(doc(db, "users/rules-employee"), { role: "sales", name: "직원", status: "active" });
    await setDoc(doc(db, "users/rules-outsider"), { role: "sales", name: "외부 직원", status: "active" });
    await setDoc(doc(db, "users/rules-inactive"), { role: "admin", name: "비활성 관리자", status: "inactive" });
    await setDoc(doc(db, "business_approver_directory/rules-admin"), { role: "admin", name: "대표", status: "active" });
    await setDoc(doc(db, "business_approver_directory/rules-accounting"), { role: "accounting", name: "회계", status: "active" });
    await setDoc(doc(db, "business_approver_directory/rules-inactive"), { role: "admin", name: "비활성 관리자", status: "active" });
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
test("일반 작성자는 공개 결재자 명단만 읽고 비활성 실제 사용자는 저장 단계에서 거부한다", async () => {
  const db = env.authenticatedContext("rules-employee", token).firestore();
  await assertSucceeds(getDoc(doc(db, "business_approver_directory/rules-admin")));
  await assertFails(getDoc(doc(db, "users/rules-admin")));
  const id = "rules-inactive-route";
  const operationId = "create-inactive-route-0001";
  const data = documentData(operationId);
  data.approverUids = ["rules-inactive"];
  data.approverNames = ["비활성 관리자"];
  const batch = writeBatch(db);
  batch.set(doc(db, "business_documents/" + id), data);
  batch.set(doc(db, "business_documents/" + id + "/history/" + operationId), history(operationId, "create", "rules-employee", "직원", "sales", "none", "draft"));
  await assertFails(batch.commit());
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

test("보완 요청 스냅샷을 고정하고 작성자 수정·재상신을 허용한다", async () => {
  const id = "rules-revision-flow";
  await createDocument(id);
  const employee = env.authenticatedContext("rules-employee", token).firestore();
  const submitId = "submit-revision-operation-0001";
  const submit = writeBatch(employee);
  submit.update(doc(employee, "business_documents/" + id), {
    status: "pending", submittedAt: serverTimestamp(), updatedAt: serverTimestamp(), lastOperationId: submitId,
  });
  submit.set(doc(employee, "business_documents/" + id + "/history/" + submitId), history(submitId, "submit", "rules-employee", "직원", "sales", "draft", "pending"));
  await assertSucceeds(submit.commit());
  const submitted = (await getDoc(doc(employee, "business_documents/" + id))).data();

  const admin = env.authenticatedContext("rules-admin", token).firestore();
  const requestId = "request-revision-operation-0001";
  const reason = "거래 근거를 구체적으로 보완하세요.";
  const requestChanges = writeBatch(admin);
  requestChanges.update(doc(admin, "business_documents/" + id), {
    status: "needs_revision", revision: 1, revisionReason: reason,
    revisionRequestedAt: serverTimestamp(), revisionRequestedBy: "rules-admin",
    revisionSnapshotId: requestId, updatedAt: serverTimestamp(), lastOperationId: requestId,
  });
  requestChanges.set(doc(admin, "business_documents/" + id + "/revisions/" + requestId), {
    schemaVersion: 1, revision: 1, details: submitted.details, attachments: submitted.attachments,
    attachmentCount: submitted.attachmentCount, approverUids: submitted.approverUids,
    approverNames: submitted.approverNames, step: submitted.step, submittedAt: submitted.submittedAt,
    reason, requestedBy: "rules-admin", requestedByName: "대표", createdAt: serverTimestamp(),
  });
  requestChanges.set(doc(admin, "business_documents/" + id + "/history/" + requestId), history(requestId, "requestChanges", "rules-admin", "대표", "admin", "pending", "needs_revision", reason));
  await assertSucceeds(requestChanges.commit());

  const updateId = "update-revision-operation-0001";
  const update = writeBatch(employee);
  update.update(doc(employee, "business_documents/" + id), {
    details: { title: "수정 완료", reason: "거래 근거와 기대 효과를 보완했습니다.", effectiveDate: "2026-10-06", amount: 0 },
    updatedAt: serverTimestamp(), lastOperationId: updateId,
  });
  update.set(doc(employee, "business_documents/" + id + "/history/" + updateId), history(updateId, "updateDraft", "rules-employee", "직원", "sales", "needs_revision", "needs_revision"));
  await assertSucceeds(update.commit());

  const resubmitId = "resubmit-revision-operation-0001";
  const resubmit = writeBatch(employee);
  resubmit.update(doc(employee, "business_documents/" + id), {
    status: "pending", revisionReason: "", revisionRequestedAt: null, revisionRequestedBy: "",
    submittedAt: serverTimestamp(), updatedAt: serverTimestamp(), lastOperationId: resubmitId,
  });
  resubmit.set(doc(employee, "business_documents/" + id + "/history/" + resubmitId), history(resubmitId, "resubmit", "rules-employee", "직원", "sales", "needs_revision", "pending"));
  await assertSucceeds(resubmit.commit());
  await assertFails(setDoc(doc(admin, "business_documents/" + id + "/revisions/" + requestId), { reason: "변조" }, { merge: true }));
});

test("ERP 내보내기는 생성·확정·취소·재시도 순서와 고정 스냅샷을 강제한다", async () => {
  const id = "rules-erp-flow";
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const seeded = documentData("seed-approved-expense-0001");
    seeded.kind = "expense";
    seeded.number = "YJ-EXPENSE-20261012-ERP001";
    seeded.details = {
      title: "ERP 이관 검증", reason: "중복 기표 방지", settlementType: "vendor", category: "material",
      taxType: "taxable", supplyAmount: 100000, taxAmount: 10000, amount: 110000,
      payee: "용진상사", transactionDate: "2026-10-12", plannedDate: "2026-10-20",
      paymentMethod: "bank_transfer", purchaseId: "", orderReference: "",
    };
    seeded.approverUids = ["rules-accounting", "rules-admin"];
    seeded.approverNames = ["회계", "대표"];
    seeded.status = "approved";
    seeded.step = 1;
    seeded.submittedAt = serverTimestamp();
    seeded.approvedAt = serverTimestamp();
    seeded.paymentStatus = "unpaid";
    seeded.erpExportStatus = "ready";
    delete seeded.erpExportRetryCount;
    await setDoc(doc(db, "business_documents/" + id), seeded);
  });

  const accounting = env.authenticatedContext("rules-accounting", token).firestore();
  const snapshot = {
    voucherDate: "2026-10-12", documentNumber: "YJ-EXPENSE-20261012-ERP001", taxType: "taxable",
    expenseCategory: "material", payee: "용진상사", supplyAmount: 100000, taxAmount: 10000,
    totalAmount: 110000, summary: "ERP 이관 검증", paymentMethod: "bank_transfer",
  };
  const generateId = "generate-erp-operation-0001";
  const generate = writeBatch(accounting);
  generate.update(doc(accounting, "business_documents/" + id), {
    schemaVersion: 10, erpExportStatus: "generated", erpExportSnapshot: snapshot,
    erpExportHash: "a".repeat(64), erpExportVersion: 1, erpExportFormat: "csv",
    erpExportCreatedAt: serverTimestamp(), erpExportCreatedBy: "rules-accounting", erpExportCreatedByName: "회계",
    erpExportedAt: null, erpExportedBy: "", erpExportConfirmedAt: null, erpExportConfirmedBy: "",
    erpExportCancelledAt: null, erpExportCancelledBy: "", erpExportCancelReason: "",
    updatedAt: serverTimestamp(), lastOperationId: generateId,
  });
  generate.set(doc(accounting, "business_documents/" + id + "/history/" + generateId), history(generateId, "generateErp", "rules-accounting", "회계", "accounting", "approved", "approved", "csv"));
  await assertSucceeds(generate.commit());

  const confirmId = "confirm-erp-operation-0001";
  const confirm = writeBatch(accounting);
  confirm.update(doc(accounting, "business_documents/" + id), {
    erpExportStatus: "confirmed", erpExportedAt: serverTimestamp(), erpExportedBy: "rules-accounting",
    erpExportConfirmedAt: serverTimestamp(), erpExportConfirmedBy: "rules-accounting",
    updatedAt: serverTimestamp(), lastOperationId: confirmId,
  });
  confirm.set(doc(accounting, "business_documents/" + id + "/history/" + confirmId), history(confirmId, "confirmErp", "rules-accounting", "회계", "accounting", "approved", "approved"));
  await assertSucceeds(confirm.commit());

  const cancelId = "cancel-erp-operation-0001";
  const cancel = writeBatch(accounting);
  cancel.update(doc(accounting, "business_documents/" + id), {
    erpExportStatus: "cancelled", erpExportCancelledAt: serverTimestamp(), erpExportCancelledBy: "rules-accounting",
    erpExportCancelReason: "더존 입력 전 오류 발견", updatedAt: serverTimestamp(), lastOperationId: cancelId,
  });
  cancel.set(doc(accounting, "business_documents/" + id + "/history/" + cancelId), history(cancelId, "cancelErp", "rules-accounting", "회계", "accounting", "approved", "approved", "더존 입력 전 오류 발견"));
  await assertSucceeds(cancel.commit());

  const retryId = "retry-erp-operation-0001";
  const retry = writeBatch(accounting);
  retry.update(doc(accounting, "business_documents/" + id), {
    erpExportStatus: "retry_pending", erpExportRetryCount: 1,
    updatedAt: serverTimestamp(), lastOperationId: retryId,
  });
  retry.set(doc(accounting, "business_documents/" + id + "/history/" + retryId), history(retryId, "retryErp", "rules-accounting", "회계", "accounting", "approved", "approved"));
  await assertSucceeds(retry.commit());

  const employee = env.authenticatedContext("rules-employee", token).firestore();
  await assertFails(setDoc(doc(employee, "business_documents/" + id), { erpExportStatus: "confirmed" }, { merge: true }));
});
