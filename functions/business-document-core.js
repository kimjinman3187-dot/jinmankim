"use strict";
// Pure domain rules shared by callable handlers and offline tests. Amounts are KRW integers.
const KINDS = Object.freeze({
  expense: "지출결의서",
  purchase: "구매·수리 요청서",
  leave: "휴가·근태 신청서",
  general: "일반 품의서",
  quality: "생산·품질 예외처리서",
});
class DocumentError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
function check(value, message, code = "failed-precondition") {
  if (!value) throw new DocumentError(code, message);
}
function text(value, label, max = 1000, optional = false) {
  check(
    typeof value === "string",
    `${label}: 문자로 입력하세요.`,
    "invalid-argument",
  );
  const s = value.trim();
  check(
    (optional || s.length > 0) && s.length <= max,
    `${label}: 입력 길이를 확인하세요.`,
    "invalid-argument",
  );
  return s;
}
function money(value, label = "금액", zero = false) {
  check(
    Number.isSafeInteger(value) &&
      value >= (zero ? 0 : 1) &&
      value <= 1000000000000,
    `${label}: 원 단위 정수로 입력하세요.`,
    "invalid-argument",
  );
  return value;
}
function date(value, label) {
  const s = text(value, label, 10);
  check(
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
      Number.isFinite(Date.parse(s + "T00:00:00Z")) &&
      new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s,
    `${label}: 날짜를 확인하세요.`,
    "invalid-argument",
  );
  return s;
}
function choice(value, values, label) {
  check(
    values.includes(value),
    `${label}: 값을 선택하세요.`,
    "invalid-argument",
  );
  return value;
}
function active(user) {
  check(
    user &&
      user.status === "active" &&
      user.uid &&
      user.name &&
      ["admin", "accounting", "sales", "factory", "factory_manager"].includes(
        user.role,
      ),
    "승인된 직원 계정이 필요합니다.",
    "permission-denied",
  );
}
function validate(kind, input) {
  check(
    Object.hasOwn(KINDS, kind),
    "지원하지 않는 문서 종류입니다.",
    "invalid-argument",
  );
  const d = input || {};
  const out = {
    title: text(d.title, "제목", 80),
    reason: text(d.reason, "사유", 2000),
  };
  if (kind === "expense") {
    out.settlementType = choice(
      d.settlementType,
      ["vendor", "reimbursement", "prepaid"],
      "처리 유형",
    );
    out.category = choice(
      d.category,
      ["material", "outsourcing", "general", "entertainment", "other"],
      "지출 구분",
    );
    out.supplyAmount = money(d.supplyAmount, "공급가액", true);
    out.taxAmount = money(d.taxAmount, "부가세", true);
    out.amount = money(out.supplyAmount + out.taxAmount);
    out.payee = text(d.payee, "지급 대상", 100);
    out.plannedDate = date(d.plannedDate, "지급 요청일");
    out.transactionDate = date(d.transactionDate, "거래일");
    out.paymentMethod = choice(
      d.paymentMethod,
      ["bank_transfer", "corporate_card", "cash"],
      "지급 수단",
    );
    check(
      out.paymentMethod !== "corporate_card" ||
        out.settlementType === "prepaid",
      "법인카드 사용은 기지급 정리로 신청하세요.",
      "invalid-argument",
    );
    out.purchaseId = text(d.purchaseId || "", "구매요청 번호", 128, true);
    out.orderReference = text(d.orderReference || "", "관련 주문", 128, true);
  } else if (kind === "purchase") {
    out.category = choice(d.category, ["purchase", "repair"], "요청 구분");
    out.item = text(d.item, "품목·수리 대상", 300);
    check(
      Number.isFinite(d.quantity) && d.quantity > 0 && d.quantity <= 1000000,
      "수량을 확인하세요.",
      "invalid-argument",
    );
    out.quantity = d.quantity;
    out.amount = money(d.amount, "예상금액");
    out.neededDate = date(d.neededDate, "필요일");
    out.vendor = text(d.vendor || "", "견적 거래처", 100, true);
  } else if (kind === "leave") {
    out.category = choice(
      d.category,
      ["annual", "half", "outing", "other"],
      "근태 구분",
    );
    out.startDate = date(d.startDate, "시작일");
    out.endDate = date(d.endDate, "종료일");
    check(
      out.endDate >= out.startDate,
      "종료일은 시작일 이후여야 합니다.",
      "invalid-argument",
    );
    check(
      Number.isFinite(d.hours) && d.hours > 0 && d.hours <= 744,
      "신청 시간을 확인하세요.",
      "invalid-argument",
    );
    out.hours = d.hours;
    out.handover = text(d.handover, "인수인계", 1000);
  } else if (kind === "quality") {
    out.orderReference = text(d.orderReference, "관련 주문", 128);
    out.category = choice(
      d.category,
      ["defect", "rework", "scrap", "delay"],
      "예외 구분",
    );
    check(
      Number.isFinite(d.quantity) && d.quantity > 0,
      "대상 수량을 확인하세요.",
      "invalid-argument",
    );
    out.quantity = d.quantity;
    out.actionPlan = text(d.actionPlan, "처리안", 1000);
    out.impact = text(d.impact, "비용·납기 영향", 1000);
  } else {
    out.effectiveDate = date(d.effectiveDate, "시행일");
    out.amount = money(d.amount || 0, "예상 비용", true);
  }
  return out;
}
function validateRoute(kind, owner, reviewer, approver) {
  active(owner);
  active(approver);
  check(
    approver.role === "admin" && approver.uid !== owner.uid,
    "작성자와 다른 관리자를 최종 승인자로 지정하세요.",
    "permission-denied",
  );
  if (kind === "expense") {
    active(reviewer);
    check(
      ["accounting", "admin"].includes(reviewer.role) &&
        reviewer.uid !== owner.uid &&
        reviewer.uid !== approver.uid,
      "검토자·작성자·최종 승인자는 서로 달라야 합니다.",
      "permission-denied",
    );
  }
  return kind === "expense" ? [reviewer.uid, approver.uid] : [approver.uid];
}
function canRead(doc, user) {
  return (
    user &&
    user.status === "active" &&
    (doc.requesterUid === user.uid ||
      user.role === "admin" ||
      doc.approverUids.includes(user.uid) ||
      (user.role === "accounting" &&
        ["expense", "purchase"].includes(doc.kind)))
  );
}
function transition(doc, user, action, reason, now) {
  active(user);
  check(doc.status === "pending", "결재 대기 문서만 처리할 수 있습니다.");
  if (action === "withdraw") {
    check(
      doc.requesterUid === user.uid,
      "작성자만 회수할 수 있습니다.",
      "permission-denied",
    );
    return { status: "withdrawn", updatedAt: now };
  }
  choice(action, ["approve", "reject"], "결재");
  check(
    doc.requesterUid !== user.uid && doc.approverUids[doc.step] === user.uid,
    "현재 지정 결재자만 처리할 수 있습니다.",
    "permission-denied",
  );
  check(
    doc.kind === "expense" && doc.step === 0
      ? ["accounting", "admin"].includes(user.role)
      : user.role === "admin",
    "현재 계정의 결재 권한이 변경되었습니다.",
    "permission-denied",
  );
  if (action === "reject")
    return {
      status: "rejected",
      rejectionReason: text(reason, "반려 사유", 500),
      updatedAt: now,
    };
  const final = doc.step === doc.approverUids.length - 1;
  return {
    step: final ? doc.step : doc.step + 1,
    status: final ? "approved" : "pending",
    approvedAt: final ? now : null,
    updatedAt: now,
  };
}
function payment(doc, user, input, now) {
  active(user);
  check(
    ["accounting", "admin"].includes(user.role),
    "회계 담당자 또는 관리자만 지급을 기록할 수 있습니다.",
    "permission-denied",
  );
  check(
    doc.kind === "expense" && doc.status === "approved",
    "승인 완료된 지출결의서만 처리할 수 있습니다.",
  );
  check(
    doc.details.settlementType !== "prepaid",
    "기지급 문서는 추가 지급 대상이 아닙니다.",
  );
  const amount = money(input.amount);
  const paid = money(doc.paidAmount || 0, "기지급액", true);
  check(
    paid + amount <= doc.details.amount,
    "승인금액을 초과하여 지급할 수 없습니다.",
  );
  date(input.paidDate, "지급일");
  const today = new Date(now + 9 * 3600000).toISOString().slice(0, 10);
  check(input.paidDate <= today, "실제 지급일은 미래 날짜일 수 없습니다.");
  text(input.reference, "이체·지급 식별번호", 120);
  return {
    paidAmount: paid + amount,
    paymentStatus: paid + amount === doc.details.amount ? "paid" : "partial",
    updatedAt: now,
  };
}
module.exports = {
  KINDS,
  DocumentError,
  check,
  text,
  money,
  date,
  active,
  validate,
  validateRoute,
  canRead,
  transition,
  payment,
};
