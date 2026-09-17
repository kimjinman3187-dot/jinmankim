"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("./business-document-core");
const users = {
  employee: { uid: "employee", name: "직원", role: "sales", status: "active" },
  finance: {
    uid: "finance",
    name: "회계",
    role: "accounting",
    status: "active",
  },
  admin: { uid: "admin", name: "대표", role: "admin", status: "active" },
  alternate: {
    uid: "alternate",
    name: "관리",
    role: "admin",
    status: "active",
  },
};
const expense = {
  title: "자재 대금",
  reason: "시험 주문 자재",
  settlementType: "vendor",
  category: "material",
  supplyAmount: 10000,
  taxAmount: 1000,
  payee: "거래처",
  plannedDate: "2026-09-16",
  transactionDate: "2026-09-15",
  paymentMethod: "bank_transfer",
};
function document() {
  return {
    kind: "expense",
    requesterUid: "employee",
    approverUids: ["finance", "admin"],
    status: "pending",
    step: 0,
    details: C.validate("expense", expense),
    paidAmount: 0,
  };
}
test("five document kinds validate structured details", () => {
  assert.equal(C.validate("expense", expense).amount, 11000);
  for (const [k, d] of Object.entries({
    purchase: {
      category: "purchase",
      item: "자재",
      quantity: 2,
      amount: 5000,
      neededDate: "2026-09-20",
    },
    leave: {
      category: "half",
      startDate: "2026-09-20",
      endDate: "2026-09-20",
      hours: 4,
      handover: "담당자에게 전달",
    },
    general: { effectiveDate: "2026-09-20", amount: 0 },
    quality: {
      category: "rework",
      quantity: 2,
      orderReference: "ORDER-1",
      actionPlan: "재작업",
      impact: "납기 하루 연장",
    },
  })) {
    assert.ok(C.validate(k, { title: "시험 문서", reason: "업무 내용", ...d }));
  }
});
test("invalid dates, negative/fractional/oversized KRW and unknown type rejected", () => {
  for (const d of [
    { plannedDate: "2026-02-30" },
    { plannedDate: "2026-99-99" },
    { supplyAmount: -1 },
    { taxAmount: 0.5 },
    { supplyAmount: 1e15 },
    { settlementType: "other" },
  ])
    assert.throws(
      () => C.validate("expense", { ...expense, ...d }),
      C.DocumentError,
    );
  assert.throws(() => C.validate("unknown", expense));
});
test("corporate card must be prepaid", () =>
  assert.throws(() =>
    C.validate("expense", { ...expense, paymentMethod: "corporate_card" }),
  ));
test("three distinct people and admin substitute reviewer work for accounting author", () => {
  assert.deepEqual(
    C.validateRoute("expense", users.finance, users.alternate, users.admin),
    ["alternate", "admin"],
  );
  assert.throws(() =>
    C.validateRoute("expense", users.finance, users.finance, users.admin),
  );
  assert.throws(() =>
    C.validateRoute("expense", users.employee, users.admin, users.admin),
  );
  assert.throws(() =>
    C.validateRoute("general", users.admin, null, users.admin),
  );
});
test("cannot skip review or self-approve; sequential route completes", () => {
  let d = document();
  assert.throws(() => C.transition(d, users.admin, "approve", "", 1));
  assert.throws(() => C.transition(d, users.employee, "approve", "", 1));
  d = { ...d, ...C.transition(d, users.finance, "approve", "", 1) };
  assert.equal(d.step, 1);
  d = { ...d, ...C.transition(d, users.admin, "approve", "", 2) };
  assert.equal(d.status, "approved");
  assert.throws(() => C.transition(d, users.admin, "approve", "", 3));
});
test("revoked reviewer role, blank rejection and non-owner withdrawal denied", () => {
  const d = document();
  assert.throws(() =>
    C.transition(d, { ...users.finance, role: "sales" }, "approve", "", 1),
  );
  assert.throws(() => C.transition(d, users.finance, "reject", "", 1));
  assert.throws(() => C.transition(d, users.admin, "withdraw", "", 1));
  assert.equal(
    C.transition(d, users.employee, "withdraw", "", 1).status,
    "withdrawn",
  );
});
test("payments require final approval, finance role, remaining balance and real date", () => {
  let d = document();
  const input = { amount: 4000, paidDate: "2026-09-16", reference: "BANK-1" };
  const now = Date.parse("2026-09-16T05:00:00Z");
  assert.throws(() => C.payment(d, users.finance, input, now));
  d.status = "approved";
  assert.throws(() => C.payment(d, users.employee, input, now));
  d = { ...d, ...C.payment(d, users.finance, input, now) };
  assert.equal(d.paidAmount, 4000);
  assert.equal(d.paymentStatus, "partial");
  assert.throws(() =>
    C.payment(d, users.finance, { ...input, amount: 8000 }, now),
  );
  assert.throws(() =>
    C.payment(d, users.finance, { ...input, paidDate: "2026-09-17" }, now),
  );
  d = { ...d, ...C.payment(d, users.finance, { ...input, amount: 7000 }, now) };
  assert.equal(d.paymentStatus, "paid");
  assert.throws(() => C.payment(d, users.finance, input, now));
});
test("prepaid never creates another payment", () => {
  const d = document();
  d.status = "approved";
  d.details.settlementType = "prepaid";
  assert.throws(() =>
    C.payment(
      d,
      users.finance,
      { amount: 1, paidDate: "2026-09-16", reference: "A" },
      Date.now(),
    ),
  );
});
test("accounting cannot read unrelated leave; inactive users have no access", () => {
  const d = { ...document(), kind: "leave", approverUids: ["admin"] };
  assert.equal(C.canRead(d, users.finance), false);
  assert.equal(C.canRead(d, users.employee), true);
  assert.equal(C.canRead(d, { ...users.admin, status: "inactive" }), false);
});
