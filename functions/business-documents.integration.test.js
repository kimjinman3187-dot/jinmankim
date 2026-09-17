"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8185")
  throw new Error("Only dedicated demo emulator 127.0.0.1:8185 is permitted");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
initializeApp({
  projectId: "demo-yj-documents",
  storageBucket: "demo-yj-documents.appspot.com",
});
const db = getFirestore();
const { handle } = require("./business-documents");
const ids = {
  employee: "employee",
  finance: "finance",
  admin: "admin",
  alternate: "alternate",
};
async function call(uid, data, verifyFiles = async () => {}) {
  return handle(
    {
      auth: { uid, token: { firebase: { sign_in_provider: "google.com" } } },
      data,
    },
    { db, verifyFiles },
  );
}
const operation = (action, id, extra = {}) => ({
  action,
  id,
  operationId: randomUUID(),
  ...extra,
});
const details = {
  title: "시험 지출",
  reason: "통합 테스트",
  settlementType: "vendor",
  category: "material",
  supplyAmount: 10000,
  taxAmount: 1000,
  payee: "시험 거래처",
  plannedDate: "2026-09-16",
  transactionDate: "2026-09-15",
  paymentMethod: "bank_transfer",
};
const proof = { name: "proof.pdf", size: 5, contentType: "application/pdf" };
async function create(kind = "expense", overrides = {}, uid = "employee") {
  const id = randomUUID();
  const d =
    kind === "expense"
      ? { ...details, ...overrides }
      : kind === "purchase"
        ? {
            title: "구매 요청",
            reason: "시험 자재",
            category: "purchase",
            item: "자재",
            quantity: 1,
            amount: 22000,
            neededDate: "2026-09-17",
            ...overrides,
          }
        : {
            title: "휴가 신청",
            reason: "인수인계",
            category: "annual",
            startDate: "2026-09-18",
            endDate: "2026-09-18",
            hours: 8,
            handover: "동료에게 전달",
            ...overrides,
          };
  await call(
    uid,
    operation("create", id, {
      kind,
      details: d,
      reviewerUid: uid === "finance" ? "alternate" : "finance",
      approverUid: "admin",
      files: kind === "expense" ? [proof] : [],
    }),
  );
  return id;
}
async function approved(kind = "expense", overrides = {}, uid = "employee") {
  const id = await create(kind, overrides, uid);
  await call(uid, operation("submit", id));
  if (kind === "expense")
    await call(
      uid === "finance" ? "alternate" : "finance",
      operation("approve", id),
    );
  await call("admin", operation("approve", id));
  return id;
}
async function prepare(id, amount, reference) {
  const paymentId = randomUUID();
  await call(
    "finance",
    operation("preparePayment", id, {
      paymentId,
      amount,
      reference,
      paidDate: "2026-09-16",
      proof,
    }),
  );
  return paymentId;
}
test.before(async () => {
  for (const [uid, role] of Object.entries({
    employee: "sales",
    finance: "accounting",
    admin: "admin",
    alternate: "admin",
    outsider: "sales",
  }))
    await db
      .collection("users")
      .doc(uid)
      .set({ name: uid, role, status: "active" });
});
test.after(async () => {
  await db.terminate();
});
test("create replay returns same document; changed request with same operation conflicts", async () => {
  const id = randomUUID();
  const op = operation("create", id, {
    kind: "expense",
    details,
    reviewerUid: "finance",
    approverUid: "admin",
    files: [proof],
  });
  const a = await call("employee", op);
  const b = await call("employee", op);
  assert.equal(a.document.number, b.document.number);
  await assert.rejects(
    call("employee", { ...op, details: { ...details, payee: "other" } }),
    (e) => e.code === "already-exists",
  );
});
test("real transaction purchase → expense → partial → full payment, immutable audit", async () => {
  const purchase = await approved("purchase");
  const id = await approved("expense", { purchaseId: purchase });
  assert.equal(
    (await db.collection("business_documents").doc(purchase).get()).data()
      .allocatedAmount,
    11000,
  );
  const p = await prepare(id, 4000, "bank-" + randomUUID());
  const op = operation("pay", id, { paymentId: p });
  await call("finance", op);
  await call("finance", op);
  let d = (await call("finance", { action: "detail", id })).document;
  assert.equal(d.paidAmount, 4000);
  const p2 = await prepare(id, 7000, "bank-" + randomUUID());
  await call("finance", operation("pay", id, { paymentId: p2 }));
  d = (await call("finance", { action: "detail", id })).document;
  assert.equal(d.paymentStatus, "paid");
  assert.equal(d.paidAmount, 11000);
  assert.equal(
    (
      await db
        .collection("business_documents")
        .doc(id)
        .collection("history")
        .get()
    ).docs.filter((s) => s.data().action === "pay").length,
    2,
  );
});
test("concurrent payments cannot exceed approved balance", async () => {
  const id = await approved();
  const a = await prepare(id, 8000, "bank-" + randomUUID());
  const b = await prepare(id, 8000, "bank-" + randomUUID());
  const r = await Promise.allSettled([
    call("finance", operation("pay", id, { paymentId: a })),
    call("finance", operation("pay", id, { paymentId: b })),
  ]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    (await call("finance", { action: "detail", id })).document.paidAmount,
    8000,
  );
});
test("duplicate bank reference across two documents is blocked", async () => {
  const a = await approved(),
    b = await approved();
  const reference = "BANK-" + randomUUID();
  const p = await prepare(a, 1000, reference);
  await call("finance", operation("pay", a, { paymentId: p }));
  const q = await prepare(b, 1000, reference.toLowerCase());
  await assert.rejects(
    call("finance", operation("pay", b, { paymentId: q })),
    (e) => e.code === "already-exists",
  );
});
test("purchase allocation limit and rejected reservation release", async () => {
  const purchase = await approved("purchase", { amount: 11000 });
  const a = await create("expense", { purchaseId: purchase });
  await call("employee", operation("submit", a));
  const b = await create("expense", { purchaseId: purchase });
  await assert.rejects(call("employee", operation("submit", b)));
  await call("finance", operation("reject", a, { reason: "증빙 정정" }));
  await call("employee", operation("submit", b));
  assert.equal(
    (await db.collection("business_documents").doc(purchase).get()).data()
      .allocatedAmount,
    11000,
  );
});
test("missing uploaded evidence never submits or records payment", async () => {
  const id = await create();
  await assert.rejects(
    call("employee", operation("submit", id), async () => {
      throw new Error("missing");
    }),
  );
  assert.equal(
    (await call("employee", { action: "detail", id })).document.status,
    "draft",
  );
  const approvedId = await approved();
  const p = await prepare(approvedId, 1000, "bank-" + randomUUID());
  await assert.rejects(
    call(
      "finance",
      operation("pay", approvedId, { paymentId: p }),
      async () => {
        throw new Error("missing");
      },
    ),
  );
  assert.equal(
    (await call("finance", { action: "detail", id: approvedId })).document
      .paidAmount,
    0,
  );
});
test("accounting authored expense uses separate reviewer, prepaid settles without payment", async () => {
  const id = await approved(
    "expense",
    { settlementType: "prepaid", paymentMethod: "corporate_card" },
    "finance",
  );
  await assert.rejects(prepare(id, 1000, "bank-" + randomUUID()));
  await call(
    "finance",
    operation("settle", id, { reason: "카드 증빙 대조 완료" }),
  );
  const d = (await call("finance", { action: "detail", id })).document;
  assert.equal(d.paymentStatus, "not_required");
  assert.equal(d.paidAmount, 0);
  assert.ok(d.settledAt);
});
test("unrelated accounting and outsider cannot retrieve leave or payments", async () => {
  const id = await create("leave");
  await assert.rejects(
    call("finance", { action: "detail", id }),
    (e) => e.code === "permission-denied",
  );
  await assert.rejects(
    call("outsider", { action: "detail", id }),
    (e) => e.code === "permission-denied",
  );
  const list = await call("finance", { action: "list" });
  assert.equal(
    list.documents.some((d) => d.id === id),
    false,
  );
});
test("revoked active status blocks mutations and anonymous auth is rejected", async () => {
  const id = await create();
  await db.collection("users").doc("employee").update({ status: "inactive" });
  try {
    await assert.rejects(
      call("employee", operation("submit", id)),
      (e) => e.code === "permission-denied",
    );
  } finally {
    await db.collection("users").doc("employee").update({ status: "active" });
  }
  await assert.rejects(
    handle(
      {
        auth: {
          uid: "employee",
          token: { firebase: { sign_in_provider: "anonymous" } },
        },
        data: { action: "list" },
      },
      { db },
    ),
    (e) => e.code === "unauthenticated",
  );
});

test("approved unpaid cancellation releases purchase allocation and permits linked revision", async () => {
  const purchase = await approved("purchase");
  const id = await approved("expense", { purchaseId: purchase });
  await assert.rejects(
    call("employee", operation("cancelApproved", id, { reason: "금액 정정" })),
  );
  await call(
    "admin",
    operation("cancelApproved", id, { reason: "금액 정정 승인 취소" }),
  );
  assert.equal(
    (await call("employee", { action: "detail", id })).document.status,
    "cancelled",
  );
  assert.equal(
    (await db.collection("business_documents").doc(purchase).get()).data()
      .allocatedAmount,
    0,
  );
  const revised = randomUUID();
  await call(
    "employee",
    operation("create", revised, {
      kind: "expense",
      details: { ...details, supplyAmount: 5000 },
      reviewerUid: "finance",
      approverUid: "admin",
      files: [proof],
      revisedFrom: id,
    }),
  );
  assert.equal(
    (await call("employee", { action: "detail", id: revised })).document
      .revisedFrom,
    id,
  );
});
test("payment recorded documents cannot be cancelled", async () => {
  const id = await approved();
  const p = await prepare(id, 1000, "bank-" + randomUUID());
  await call("finance", operation("pay", id, { paymentId: p }));
  await assert.rejects(
    call("admin", operation("cancelApproved", id, { reason: "취소 시도" })),
  );
  assert.equal(
    (await call("finance", { action: "detail", id })).document.status,
    "approved",
  );
});
test("real Storage metadata verification rejects missing evidence and accepts uploaded bytes", async () => {
  if (process.env.FIREBASE_STORAGE_EMULATOR_HOST !== "127.0.0.1:9295")
    throw new Error("Dedicated Storage emulator required");
  const id = await create();
  const request = {
    auth: {
      uid: "employee",
      token: { firebase: { sign_in_provider: "google.com" } },
    },
    data: operation("submit", id),
  };
  await assert.rejects(handle(request, { db }));
  const { getStorage } = require("firebase-admin/storage");
  await getStorage()
    .bucket()
    .file(`business-document-files/${id}/a0`)
    .save(Buffer.from([1, 2, 3, 4, 5]), { contentType: "application/pdf" });
  await handle(request, { db });
  assert.equal(
    (await call("employee", { action: "detail", id })).document.status,
    "pending",
  );
});
