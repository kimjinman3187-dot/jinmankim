(function (global) {
  "use strict";
  const COLLECTION = "business_documents";
  const KINDS = ["expense", "purchase", "leave", "general", "quality"];
  const MIME = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv" };
  function fail(code, message) { const e = new Error(message); e.code = code; throw e; }
  function check(value, message, code = "failed-precondition") { if (!value) fail(code, message); }
  function text(value, label, max, optional = false) {
    check(typeof value === "string", label + ": 문자로 입력하세요.", "invalid-argument");
    const result = value.trim();
    check((optional || result.length > 0) && result.length <= max, label + ": 입력 길이를 확인하세요.", "invalid-argument");
    return result;
  }
  function money(value, label, zero = false) {
    check(Number.isSafeInteger(value) && value >= (zero ? 0 : 1) && value <= 1000000000000, label + ": 원 단위 정수로 입력하세요.", "invalid-argument");
    return value;
  }
  function date(value, label) {
    const result = text(value, label, 10);
    check(/^\d{4}-\d{2}-\d{2}$/.test(result) && new Date(result + "T00:00:00Z").toISOString().slice(0, 10) === result, label + ": 날짜를 확인하세요.", "invalid-argument");
    return result;
  }
  function choice(value, values, label) { check(values.includes(value), label + ": 값을 선택하세요.", "invalid-argument"); return value; }
  function validate(kind, input) {
    check(KINDS.includes(kind), "지원하지 않는 문서 종류입니다.", "invalid-argument");
    const d = input || {};
    const out = { title: text(d.title, "제목", 80), reason: text(d.reason, "사유", 2000) };
    if (kind === "expense") {
      out.settlementType = choice(d.settlementType, ["vendor", "reimbursement", "prepaid"], "처리 유형");
      out.category = choice(d.category, ["material", "outsourcing", "general", "entertainment", "other"], "지출 구분");
      out.supplyAmount = money(d.supplyAmount, "공급가액", true); out.taxAmount = money(d.taxAmount, "부가세", true);
      out.amount = money(out.supplyAmount + out.taxAmount, "총액"); out.payee = text(d.payee, "지급 대상", 100);
      out.transactionDate = date(d.transactionDate, "거래일"); out.plannedDate = date(d.plannedDate, "지급 요청일");
      out.paymentMethod = choice(d.paymentMethod, ["bank_transfer", "corporate_card", "cash"], "지급 수단");
      check(out.paymentMethod !== "corporate_card" || out.settlementType === "prepaid", "법인카드 사용은 기지급 정리로 신청하세요.", "invalid-argument");
      out.purchaseId = text(d.purchaseId || "", "구매요청 번호", 128, true); out.orderReference = text(d.orderReference || "", "관련 주문", 128, true);
    } else if (kind === "purchase") {
      out.category = choice(d.category, ["purchase", "repair"], "요청 구분"); out.item = text(d.item, "품목·수리 대상", 300);
      check(Number.isFinite(d.quantity) && d.quantity > 0 && d.quantity <= 1000000, "수량을 확인하세요.", "invalid-argument");
      out.quantity = d.quantity; out.amount = money(d.amount, "예상금액"); out.neededDate = date(d.neededDate, "필요일"); out.vendor = text(d.vendor || "", "견적 거래처", 100, true);
    } else if (kind === "leave") {
      out.category = choice(d.category, ["annual", "half", "outing", "other"], "근태 구분"); out.startDate = date(d.startDate, "시작일"); out.endDate = date(d.endDate, "종료일");
      check(out.endDate >= out.startDate, "종료일은 시작일 이후여야 합니다.", "invalid-argument"); check(Number.isFinite(d.hours) && d.hours > 0 && d.hours <= 744, "신청 시간을 확인하세요.", "invalid-argument");
      out.hours = d.hours; out.handover = text(d.handover, "인수인계", 1000);
    } else if (kind === "quality") {
      out.orderReference = text(d.orderReference, "관련 주문", 128); out.category = choice(d.category, ["defect", "rework", "scrap", "delay"], "예외 구분");
      check(Number.isFinite(d.quantity) && d.quantity > 0, "대상 수량을 확인하세요.", "invalid-argument"); out.quantity = d.quantity;
      out.actionPlan = text(d.actionPlan, "처리안", 1000); out.impact = text(d.impact, "비용·납기 영향", 1000);
    } else { out.effectiveDate = date(d.effectiveDate, "시행일"); out.amount = money(d.amount || 0, "예상 비용", true); }
    return out;
  }
  function database() { check(global.db?.collection, "문서 저장소 연결이 준비되지 않았습니다.", "unavailable"); return global.db; }
  function serverTime() { return global.firebase.firestore.FieldValue.serverTimestamp(); }
  function millis(value) { if (!value) return 0; if (typeof value.toMillis === "function") return value.toMillis(); if (typeof value.toDate === "function") return value.toDate().getTime(); return Number(value) || 0; }
  async function actor() {
    const auth = global.auth?.currentUser; check(auth?.uid, "로그인이 필요합니다.", "unauthenticated");
    const snapshot = await database().collection("users").doc(auth.uid).get(); const user = { uid: auth.uid, ...(snapshot.data() || {}) };
    check(snapshot.exists && user.status === "active" && user.name && ["admin", "accounting", "sales", "factory", "factory_manager"].includes(user.role), "승인된 개인 계정이 필요합니다.", "permission-denied");
    return user;
  }
  const publicDoc = (snapshot) => ({ id: snapshot.id, ...snapshot.data() });
  async function directory() {
    await actor(); const snapshot = await database().collection("business_approver_directory").where("status", "==", "active").limit(201).get();
    return { users: snapshot.docs.slice(0, 200).map((s) => ({ uid: s.id, name: s.data().name, role: s.data().role })), capped: snapshot.size > 200 };
  }
  async function list() {
    const user = await actor(); const base = database().collection(COLLECTION);
    const queries = user.role === "admin" ? [base.orderBy("createdAt", "desc")] : [base.where("requesterUid", "==", user.uid), base.where("approverUids", "array-contains", user.uid)];
    if (user.role === "accounting") queries.push(base.where("kind", "in", ["expense", "purchase"]));
    const results = await Promise.all(queries.map((query) => query.limit(101).get())); const rows = new Map();
    results.forEach((result) => result.docs.slice(0, 100).forEach((snapshot) => rows.set(snapshot.id, publicDoc(snapshot))));
    return { documents: [...rows.values()].sort((a, b) => millis(b.createdAt) - millis(a.createdAt)), capped: results.some((result) => result.size > 100) };
  }
  async function detail(id) {
    await actor(); const ref = database().collection(COLLECTION).doc(id);
    const [document, history] = await Promise.all([ref.get(), ref.collection("history").orderBy("at", "desc").limit(101).get()]);
    check(document.exists, "문서를 찾을 수 없습니다.", "not-found");
    return { document: publicDoc(document), history: history.docs.slice(0, 100).map(publicDoc), payments: [], capped: history.size > 100 };
  }

  function fileMeta(file, documentId, slot) {
    const name = text(file.name, "파일명", 255); const ext = name.split(".").pop().toLowerCase();
    check(MIME[ext] && MIME[ext] === file.contentType, "첨부는 PDF·이미지·XLSX·CSV만 지원합니다.", "invalid-argument");
    check(Number.isSafeInteger(file.size) && file.size > 0 && file.size <= 10485760, "파일당 10MB 이하만 첨부할 수 있습니다.", "invalid-argument");
    return { name, size: file.size, contentType: file.contentType, storagePath: "business-document-files/" + documentId + "/" + slot };
  }
  async function loadRoute(kind, requester, reviewerUid, approverUid) {
    const ids = kind === "expense" ? [reviewerUid, approverUid] : [approverUid];
    check(ids.every(Boolean) && new Set([requester.uid, ...ids]).size === ids.length + 1, "작성자·검토자·최종 승인자는 서로 달라야 합니다.", "permission-denied");
    const snapshots = await Promise.all(ids.map((uid) => database().collection("business_approver_directory").doc(uid).get()));
    const users = snapshots.map((snapshot, index) => ({ uid: ids[index], ...(snapshot.data() || {}) }));
    users.forEach((user) => check(user.status === "active", "활성 결재자를 선택하세요.", "permission-denied"));
    check(users.at(-1).role === "admin", "최종 승인자는 관리자여야 합니다.", "permission-denied");
    if (kind === "expense") check(["accounting", "admin"].includes(users[0].role), "지출결의 검토자는 회계 또는 관리자여야 합니다.", "permission-denied");
    return users;
  }
  function historyData(operationId, action, user, reason, previousStatus, nextStatus) {
    return { operationId, action, actorUid: user.uid, actorName: user.name, actorRole: user.role, at: serverTime(), reason: String(reason || "").trim().slice(0, 500), previousStatus, nextStatus };
  }
  async function create(data) {
    const user = await actor(); const details = validate(data.kind, data.details);
    const route = await loadRoute(data.kind, user, data.reviewerUid, data.approverUid); const files = Array.isArray(data.files) ? data.files : [];
    check(files.length <= 5 && (data.kind !== "expense" || files.length > 0), data.kind === "expense" ? "지출결의서는 증빙을 첨부하세요." : "첨부는 최대 5개입니다.", "invalid-argument");
    const attachments = {}; files.forEach((file, index) => { attachments["a" + index] = fileMeta(file, data.id, "a" + index); });
    const totalSize = Object.values(attachments).reduce((sum, item) => sum + item.size, 0); check(totalSize <= 31457280, "첨부 합계는 30MB 이하입니다.", "invalid-argument");
    if (data.revisedFrom) {
      const old = await database().collection(COLLECTION).doc(data.revisedFrom).get();
      check(old.exists && old.data().requesterUid === user.uid && ["rejected", "withdrawn", "cancelled"].includes(old.data().status), "반려·회수·취소한 본인 문서만 재작성할 수 있습니다.", "permission-denied");
    }
    const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replace(/-/g, "");
    const document = {
      schemaVersion: 5, clientMode: "spark", kind: data.kind,
      number: "YJ-" + data.kind.toUpperCase() + "-" + dateKey + "-" + data.id.replace(/-/g, "").slice(-6).toUpperCase(),
      details, requesterUid: user.uid, requesterName: user.name, requesterRole: user.role,
      approverUids: route.map((item) => item.uid), approverNames: route.map((item) => item.name),
      status: "draft", step: 0, attachments, attachmentCount: files.length, attachmentsTotalSize: totalSize,
      createdAt: serverTime(), updatedAt: serverTime(), submittedAt: null, approvedAt: null, rejectionReason: "",
      paidAmount: 0, paymentStatus: data.kind === "expense" ? (details.settlementType === "prepaid" ? "not_required" : "unpaid") : null,
      settledAt: null, completedAt: null, allocatedAmount: 0, purchaseReserved: false,
      revisedFrom: data.revisedFrom || "", lastOperationId: data.operationId,
    };
    const ref = database().collection(COLLECTION).doc(data.id); const historyRef = ref.collection("history").doc(data.operationId);
    await database().runTransaction(async (tx) => {
      const [existing, event] = await Promise.all([tx.get(ref), tx.get(historyRef)]); if (event.exists) return;
      check(!existing.exists, "이미 존재하는 문서입니다.", "already-exists");
      tx.set(ref, document); tx.set(historyRef, historyData(data.operationId, "create", user, "", "none", "draft"));
    });
    return { ok: true, id: data.id, document };
  }
  async function verifyAttachments(document) {
    for (const file of Object.values(document.attachments || {})) {
      let metadata;
      try { metadata = await global.firebase.storage().ref(file.storagePath).getMetadata(); }
      catch (_) { fail("failed-precondition", "첨부 업로드가 완료되지 않았습니다."); }
      check(Number(metadata.size) === file.size && metadata.contentType === file.contentType, "첨부파일 정보가 등록 내용과 다릅니다.");
    }
  }
  async function transition(data) {
    const user = await actor(); const ref = database().collection(COLLECTION).doc(data.id);
    if (data.action === "submit") { const snapshot = await ref.get(); check(snapshot.exists, "문서를 찾을 수 없습니다.", "not-found"); await verifyAttachments(snapshot.data()); }
    const historyRef = ref.collection("history").doc(data.operationId);
    return database().runTransaction(async (tx) => {
      const [snapshot, existing] = await Promise.all([tx.get(ref), tx.get(historyRef)]);
      if (existing.exists) return { ok: true, duplicate: true, status: existing.data().nextStatus };
      check(snapshot.exists, "문서를 찾을 수 없습니다.", "not-found");
      const document = snapshot.data(); const previous = document.status; let patch;
      if (data.action === "submit") {
        check(document.requesterUid === user.uid && document.status === "draft", "본인의 작성 중 문서만 제출할 수 있습니다.", "permission-denied");
        patch = { status: "pending", submittedAt: serverTime(), updatedAt: serverTime(), lastOperationId: data.operationId };
      } else if (data.action === "withdraw") {
        check(document.requesterUid === user.uid && document.status === "pending", "작성자만 결재 대기 문서를 회수할 수 있습니다.", "permission-denied");
        patch = { status: "withdrawn", updatedAt: serverTime(), lastOperationId: data.operationId };
      } else if (["approve", "reject"].includes(data.action)) {
        check(document.status === "pending" && document.requesterUid !== user.uid && document.approverUids[document.step] === user.uid, "현재 지정 결재자만 처리할 수 있습니다.", "permission-denied");
        const roles = document.kind === "expense" && document.step === 0 ? ["accounting", "admin"] : ["admin"];
        check(roles.includes(user.role), "현재 계정의 결재 권한이 변경되었습니다.", "permission-denied");
        if (data.action === "reject") {
          patch = { status: "rejected", rejectionReason: text(data.reason || "", "반려 사유", 500), updatedAt: serverTime(), lastOperationId: data.operationId };
        } else {
          const final = document.step === document.approverUids.length - 1;
          patch = { status: final ? "approved" : "pending", step: final ? document.step : document.step + 1, approvedAt: final ? serverTime() : null, updatedAt: serverTime(), lastOperationId: data.operationId };
        }
      } else fail("failed-precondition", "무료 요금제 1단계에서는 문서 결재 기능만 지원합니다.");
      const next = patch.status || document.status; tx.update(ref, patch);
      tx.set(historyRef, historyData(data.operationId, data.action, user, data.reason, previous, next));
      return { ok: true, id: data.id, status: next };
    });
  }
  async function request(data) {
    if (data.action === "directory") return directory(); if (data.action === "list") return list();
    if (data.action === "detail") return detail(data.id); if (data.action === "create") return create(data); return transition(data);
  }
  global.YJBusinessDocumentClient = { request, validate, millis };
})(window);
