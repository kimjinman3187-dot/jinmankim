import { after, before, beforeEach, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import * as fs from "firebase/firestore";
import { makeFirestoreEnv, seedUsers, USERS } from "./helpers.mjs";

let env;
const docId = "expense-approved-1";
const paymentId = "payment-1";
const payOperation = "pay-operation-0000001";
const reference = "BANK-001";

const expenseDetails = {
  title: "지급 테스트",
  reason: "승인된 거래처 지급",
  settlementType: "vendor",
  category: "material",
  taxType: "taxable",
  supplyAmount: 10000,
  taxAmount: 0,
  amount: 10000,
  payee: "테스트 거래처",
  transactionDate: "2026-10-01",
  plannedDate: "2026-10-08",
  paymentMethod: "bank_transfer",
  purchaseId: "",
  orderReference: "",
};

function approvedExpense() {
  const now = fs.Timestamp.now();
  return {
    schemaVersion: 8,
    clientMode: "spark-firestore",
    kind: "expense",
    number: "YJ-EXPENSE-20261008-TEST01",
    details: expenseDetails,
    requesterUid: "emp1",
    requesterName: USERS.emp1.name,
    requesterRole: USERS.emp1.role,
    approverUids: ["emp2", "admin1"],
    approverNames: [USERS.emp2.name, USERS.admin1.name],
    status: "approved",
    step: 1,
    attachments: {},
    attachmentCount: 0,
    attachmentsTotalSize: 0,
    createdAt: now,
    updatedAt: now,
    submittedAt: now,
    approvedAt: now,
    rejectionReason: "",
    paidAmount: 0,
    paymentStatus: "unpaid",
    settledAt: null,
    completedAt: null,
    completionNote: "",
    cancellationReason: "",
    allocatedAmount: 0,
    purchaseReserved: false,
    revisedFrom: "",
    lastOperationId: "approve-operation-00001",
  };
}

function proof() {
  return {
    name: "payment_test.pdf",
    size: 4,
    contentType: "application/pdf",
    chunkCount: 1,
    sha256: "a".repeat(64),
    firestorePath: `business_documents/${docId}/payments/${paymentId}/proof_upload`,
  };
}

function paymentDraft() {
  return {
    schemaVersion: 1,
    status: "draft",
    amount: 4000,
    paidDate: "2026-10-08",
    reference,
    proof: proof(),
    actorUid: "emp2",
    actorName: USERS.emp2.name,
    actorRole: USERS.emp2.role,
    operationId: "prepare-payment-00001",
    createdAt: fs.serverTimestamp(),
    recordedAt: null,
  };
}

async function seedBase() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await fs.setDoc(fs.doc(db, "business_documents", docId), approvedExpense());
    await fs.setDoc(fs.doc(db, "business_approver_directory", "emp2"), {
      name: USERS.emp2.name,
      role: USERS.emp2.role,
      status: "active",
    });
    await fs.setDoc(fs.doc(db, "business_approver_directory", "admin1"), {
      name: USERS.admin1.name,
      role: USERS.admin1.role,
      status: "active",
    });
  });
}

before(async () => {
  env = await makeFirestoreEnv();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seedUsers(env);
  await seedBase();
});

after(async () => {
  await env.cleanup();
});

test("회계는 승인된 지출결의서에 지급 준비 기록을 생성할 수 있다", async () => {
  const db = env.authenticatedContext("emp2").firestore();
  await assertSucceeds(
    fs.setDoc(
      fs.doc(db, "business_documents", docId, "payments", paymentId),
      paymentDraft(),
    ),
  );
});

test("거래처·계약조건 승인서를 초안과 생성 이력으로 함께 저장할 수 있다", async () => {
  const db = env.authenticatedContext("emp1").firestore();
  const contractId = "vendor-contract-draft-1";
  const operationId = "create-contract-00001";
  const batch = fs.writeBatch(db);
  batch.set(fs.doc(db, "business_documents", contractId), {
    schemaVersion: 9,
    clientMode: "spark-firestore",
    kind: "vendor_contract",
    number: "YJ-CONTRACT-20261008-TEST01",
    details: {
      title: "원자재 공급계약 검토",
      reason: "신규 거래처 계약조건 사전 승인",
      partnerName: "테스트 공급사",
      contractType: "supply",
      startDate: "2026-10-09",
      endDate: "2027-10-08",
      contractAmount: 12000000,
      paymentTerms: "월말 마감 후 익월 말 지급",
      renewalTerms: "만료 30일 전 서면 합의",
      ownerDepartment: "구매팀",
      riskNotes: "단가 조정 조항 확인 필요",
    },
    requesterUid: "emp1",
    requesterName: USERS.emp1.name,
    requesterRole: USERS.emp1.role,
    approverUids: [],
    approverNames: [],
    status: "draft",
    step: 0,
    attachments: {},
    attachmentCount: 0,
    attachmentsTotalSize: 0,
    createdAt: fs.serverTimestamp(),
    updatedAt: fs.serverTimestamp(),
    submittedAt: null,
    approvedAt: null,
    rejectionReason: "",
    paidAmount: 0,
    paymentStatus: null,
    settledAt: null,
    completedAt: null,
    completionNote: "",
    cancellationReason: "",
    allocatedAmount: 0,
    purchaseReserved: false,
    revisedFrom: "",
    erpExportStatus: null,
    erpExportedAt: null,
    erpExportedBy: "",
    lastOperationId: operationId,
  });
  batch.set(fs.doc(db, "business_documents", contractId, "history", operationId), {
    operationId,
    action: "create",
    actorUid: "emp1",
    actorName: USERS.emp1.name,
    actorRole: USERS.emp1.role,
    at: fs.serverTimestamp(),
    reason: "",
    previousStatus: "none",
    nextStatus: "draft",
  });
  await assertSucceeds(batch.commit());
});

test("스키마 9 지출결의서는 과세구분과 ERP 초기상태를 함께 저장한다", async () => {
  const db = env.authenticatedContext("emp1").firestore();
  const id = "expense-schema9-draft";
  const operationId = "create-expense-schema9-001";
  const row = {
    ...approvedExpense(),
    schemaVersion: 9,
    number: "YJ-EXPENSE-20261009-SCHEMA9",
    details: {
      ...expenseDetails,
      taxType: "exempt",
      supplyAmount: 10000,
      taxAmount: 0,
      amount: 10000,
    },
    approverUids: [],
    approverNames: [],
    status: "draft",
    step: 0,
    createdAt: fs.serverTimestamp(),
    updatedAt: fs.serverTimestamp(),
    submittedAt: null,
    approvedAt: null,
    erpExportStatus: "not_ready",
    erpExportedAt: null,
    erpExportedBy: "",
    lastOperationId: operationId,
  };
  const batch = fs.writeBatch(db);
  batch.set(fs.doc(db, "business_documents", id), row);
  batch.set(fs.doc(db, "business_documents", id, "history", operationId), {
    operationId,
    action: "create",
    actorUid: "emp1",
    actorName: USERS.emp1.name,
    actorRole: USERS.emp1.role,
    at: fs.serverTimestamp(),
    reason: "",
    previousStatus: "none",
    nextStatus: "draft",
  });
  await assertSucceeds(batch.commit());
});

test("면세 지출결의서에 부가세를 넣으면 Rules가 차단한다", async () => {
  const db = env.authenticatedContext("emp1").firestore();
  const id = "expense-invalid-exempt-tax";
  const operationId = "create-expense-invalid-001";
  const row = {
    ...approvedExpense(),
    schemaVersion: 9,
    number: "YJ-EXPENSE-20261009-BADTAX",
    details: {
      ...expenseDetails,
      taxType: "exempt",
      supplyAmount: 10000,
      taxAmount: 1000,
      amount: 11000,
    },
    approverUids: [],
    approverNames: [],
    status: "draft",
    step: 0,
    createdAt: fs.serverTimestamp(),
    updatedAt: fs.serverTimestamp(),
    submittedAt: null,
    approvedAt: null,
    erpExportStatus: "not_ready",
    erpExportedAt: null,
    erpExportedBy: "",
    lastOperationId: operationId,
  };
  const batch = fs.writeBatch(db);
  batch.set(fs.doc(db, "business_documents", id), row);
  batch.set(fs.doc(db, "business_documents", id, "history", operationId), {
    operationId,
    action: "create",
    actorUid: "emp1",
    actorName: USERS.emp1.name,
    actorRole: USERS.emp1.role,
    at: fs.serverTimestamp(),
    reason: "",
    previousStatus: "none",
    nextStatus: "draft",
  });
  await assertFails(batch.commit());
});

test("일반 직원은 지급 준비 기록을 생성할 수 없다", async () => {
  const db = env.authenticatedContext("emp1").firestore();
  await assertFails(
    fs.setDoc(
      fs.doc(db, "business_documents", docId, "payments", paymentId),
      { ...paymentDraft(), actorUid: "emp1", actorName: USERS.emp1.name, actorRole: USERS.emp1.role },
    ),
  );
});

test("회계는 승인 문서를 ERP 이관 완료로 한 번만 잠글 수 있다", async () => {
  const db = env.authenticatedContext("emp2").firestore();
  const documentRef = fs.doc(db, "business_documents", docId);
  const operationId = "erp-export-operation-0001";
  const batch = fs.writeBatch(db);
  batch.update(documentRef, {
    schemaVersion: 9,
    erpExportStatus: "exported",
    erpExportedAt: fs.serverTimestamp(),
    erpExportedBy: "emp2",
    updatedAt: fs.serverTimestamp(),
    lastOperationId: operationId,
  });
  batch.set(fs.doc(db, "business_documents", docId, "history", operationId), {
    operationId,
    action: "exportErp",
    actorUid: "emp2",
    actorName: USERS.emp2.name,
    actorRole: USERS.emp2.role,
    at: fs.serverTimestamp(),
    reason: "csv",
    previousStatus: "approved",
    nextStatus: "approved",
  });
  await assertSucceeds(batch.commit());

  const duplicateId = "erp-export-operation-0002";
  const duplicate = fs.writeBatch(db);
  duplicate.update(documentRef, {
    schemaVersion: 9,
    erpExportStatus: "exported",
    erpExportedAt: fs.serverTimestamp(),
    erpExportedBy: "emp2",
    updatedAt: fs.serverTimestamp(),
    lastOperationId: duplicateId,
  });
  duplicate.set(fs.doc(db, "business_documents", docId, "history", duplicateId), {
    operationId: duplicateId,
    action: "exportErp",
    actorUid: "emp2",
    actorName: USERS.emp2.name,
    actorRole: USERS.emp2.role,
    at: fs.serverTimestamp(),
    reason: "json",
    previousStatus: "approved",
    nextStatus: "approved",
  });
  await assertFails(duplicate.commit());
});

test("지급 증빙 청크·완료 표시 후 지급·이력·중복번호·알림을 원자적으로 기록한다", async () => {
  const db = env.authenticatedContext("emp2").firestore();
  const documentRef = fs.doc(db, "business_documents", docId);
  const paymentRef = fs.doc(db, "business_documents", docId, "payments", paymentId);
  await fs.setDoc(paymentRef, paymentDraft());
  await fs.setDoc(
    fs.doc(db, "business_documents", docId, "payments", paymentId, "proof_chunks", "0"),
    {
      index: 0,
      size: 4,
      sha256: "a".repeat(64),
      data: fs.Bytes.fromUint8Array(new Uint8Array([1, 2, 3, 4])),
      uploaderUid: "emp2",
      uploadedAt: fs.serverTimestamp(),
    },
  );
  await fs.setDoc(
    fs.doc(db, "business_documents", docId, "payments", paymentId, "proof_upload", "manifest"),
    { ...proof(), uploaderUid: "emp2", completedAt: fs.serverTimestamp() },
  );
  const batch = fs.writeBatch(db);
  batch.update(paymentRef, { status: "recorded", recordedAt: fs.serverTimestamp() });
  batch.set(fs.doc(db, "business_payment_references", reference), {
    documentId: docId,
    paymentId,
    reference,
    actorUid: "emp2",
    createdAt: fs.serverTimestamp(),
  });
  batch.update(documentRef, {
    paidAmount: 4000,
    paymentStatus: "partial",
    updatedAt: fs.serverTimestamp(),
    lastOperationId: payOperation,
  });
  batch.set(fs.doc(db, "business_documents", docId, "history", payOperation), {
    operationId: payOperation,
    action: "pay",
    actorUid: "emp2",
    actorName: USERS.emp2.name,
    actorRole: USERS.emp2.role,
    at: fs.serverTimestamp(),
    reason: reference,
    previousStatus: "approved",
    nextStatus: "approved",
  });
  batch.set(fs.doc(db, "business_document_notifications", `${payOperation}-emp1`), {
    schemaVersion: 1,
    documentId: docId,
    number: "YJ-EXPENSE-20261008-TEST01",
    kind: "expense",
    title: "지급 테스트",
    event: "payment_recorded",
    recipientUid: "emp1",
    actorUid: "emp2",
    actorName: USERS.emp2.name,
    operationId: payOperation,
    createdAt: fs.serverTimestamp(),
    readAt: null,
  });
  await assertSucceeds(batch.commit());
});

test("사용자별 알림은 수신자만 읽고 읽음 처리한다", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await fs.setDoc(fs.doc(ctx.firestore(), "business_document_notifications", "notice-emp1"), {
      schemaVersion: 1,
      documentId: docId,
      number: "YJ-EXPENSE-20261008-TEST01",
      kind: "expense",
      title: "지급 테스트",
      event: "approval_completed",
      recipientUid: "emp1",
      actorUid: "admin1",
      actorName: USERS.admin1.name,
      operationId: "notice-operation-0001",
      createdAt: fs.Timestamp.now(),
      readAt: null,
    });
  });
  const mine = env.authenticatedContext("emp1").firestore();
  const other = env.authenticatedContext("emp2").firestore();
  const mineRef = fs.doc(mine, "business_document_notifications", "notice-emp1");
  await assertSucceeds(fs.getDoc(mineRef));
  await assertFails(fs.getDoc(fs.doc(other, "business_document_notifications", "notice-emp1")));
  await assertSucceeds(fs.updateDoc(mineRef, { readAt: fs.serverTimestamp() }));
});

test("문서 이력과 결합되지 않은 임의 알림 생성은 차단한다", async () => {
  const db = env.authenticatedContext("emp2").firestore();
  await assertFails(
    fs.setDoc(fs.doc(db, "business_document_notifications", "fake-operation-emp1"), {
      schemaVersion: 1,
      documentId: docId,
      number: "YJ-EXPENSE-20261008-TEST01",
      kind: "expense",
      title: "지급 테스트",
      event: "payment_recorded",
      recipientUid: "emp1",
      actorUid: "emp2",
      actorName: USERS.emp2.name,
      operationId: "fake-operation",
      createdAt: fs.serverTimestamp(),
      readAt: null,
    }),
  );
});
