"use strict";
const { createHash } = require("node:crypto");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const C = require("./business-document-core");
const COLLECTION = "business_documents";
const MIME = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
function id(value) {
  C.check(
    typeof value === "string" && /^[A-Za-z0-9_-]{16,80}$/.test(value),
    "요청 식별자가 올바르지 않습니다.",
    "invalid-argument",
  );
  return value;
}
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
function attachment(file, path) {
  C.check(
    file && typeof file === "object",
    "첨부파일 정보가 필요합니다.",
    "invalid-argument",
  );
  const name = C.text(file.name, "파일명", 255);
  const ext = name.split(".").pop().toLowerCase();
  C.check(
    MIME[ext] && file.contentType === MIME[ext],
    "첨부는 PDF·이미지·XLSX·CSV만 지원합니다.",
    "invalid-argument",
  );
  C.check(
    Number.isSafeInteger(file.size) && file.size > 0 && file.size <= 10485760,
    "파일당 10MB 이하만 첨부할 수 있습니다.",
    "invalid-argument",
  );
  return {
    name,
    size: file.size,
    contentType: file.contentType,
    storagePath: path,
  };
}
async function verifyFiles(files) {
  const app = getApp();
  const bucketName =
    app.options.storageBucket || `${app.options.projectId}.firebasestorage.app`;
  for (const file of Object.values(files || {})) {
    const [meta] = await getStorage()
      .bucket(bucketName)
      .file(file.storagePath)
      .getMetadata();
    C.check(
      Number(meta.size) === file.size && meta.contentType === file.contentType,
      "첨부 업로드가 완료되지 않았거나 파일 정보가 다릅니다.",
    );
  }
}
async function readUser(reader, db, uid) {
  const ref = db.collection("users").doc(uid);
  const snap = await (reader === db ? ref.get() : reader.get(ref));
  const u = { ...(snap.data() || {}), uid };
  C.active(u);
  return u;
}
function publicDoc(snap) {
  return { id: snap.id, ...snap.data() };
}
async function handle(request, dependencies = {}) {
  C.check(
    request.auth?.uid &&
      request.auth.token?.firebase?.sign_in_provider !== "anonymous",
    "개인 계정으로 로그인하세요.",
    "unauthenticated",
  );
  const db = dependencies.db || getFirestore();
  const verify = dependencies.verifyFiles || verifyFiles;
  const uid = request.auth.uid;
  const data = request.data || {};
  const action = data.action;
  const user = await readUser(db, db, uid);
  if (action === "directory") {
    const snaps = await db
      .collection("users")
      .where("status", "==", "active")
      .limit(201)
      .get();
    return {
      users: snaps.docs
        .slice(0, 200)
        .map((s) => ({ uid: s.id, name: s.data().name, role: s.data().role }))
        .filter((u) => ["admin", "accounting"].includes(u.role)),
      capped: snaps.size > 200,
    };
  }
  if (action === "list") {
    const base = db.collection(COLLECTION);
    let queries;
    if (user.role === "admin") queries = [base.orderBy("createdAt", "desc")];
    else {
      queries = [
        base.where("requesterUid", "==", uid),
        base.where("approverUids", "array-contains", uid),
      ];
      if (user.role === "accounting")
        queries.push(base.where("kind", "in", ["expense", "purchase"]));
    }
    const results = await Promise.all(queries.map((q) => q.limit(101).get()));
    const rows = new Map();
    for (const r of results)
      for (const s of r.docs.slice(0, 100))
        if (C.canRead(s.data(), user)) rows.set(s.id, publicDoc(s));
    return {
      documents: [...rows.values()].sort((a, b) => b.createdAt - a.createdAt),
      capped: results.some((r) => r.size > 100),
    };
  }
  const requestId = id(data.id);
  const ref = db.collection(COLLECTION).doc(requestId);
  if (action === "detail") {
    const s = await ref.get();
    C.check(
      s.exists && C.canRead(s.data(), user),
      "문서 접근 권한이 없습니다.",
      "permission-denied",
    );
    const [h, p] = await Promise.all([
      ref.collection("history").orderBy("at", "desc").limit(101).get(),
      ref.collection("payments").orderBy("createdAt", "desc").limit(101).get(),
    ]);
    return {
      document: publicDoc(s),
      history: h.docs.slice(0, 100).map(publicDoc),
      payments: p.docs.slice(0, 100).map(publicDoc),
      capped: h.size > 100 || p.size > 100,
    };
  }
  const operationId = id(data.operationId);
  const fingerprint = hash(canonical({ uid, ...data }));
  return db.runTransaction(async (tx) => {
    const actor = await readUser(tx, db, uid);
    const eventRef = ref.collection("history").doc(operationId);
    const [snap, event] = await Promise.all([tx.get(ref), tx.get(eventRef)]);
    if (event.exists) {
      C.check(
        event.data().fingerprint === fingerprint,
        "같은 요청번호로 다른 처리를 시도했습니다.",
        "already-exists",
      );
      return event.data().result;
    }
    const now = Date.now();
    let result = { ok: true, id: requestId };
    let patch = {};
    let doc = snap.data();
    let extra = {};
    if (action === "create") {
      C.check(!snap.exists, "이미 존재하는 문서입니다.", "already-exists");
      const details = C.validate(data.kind, data.details);
      const approver = await readUser(
        tx,
        db,
        C.text(data.approverUid, "승인자", 128),
      );
      const reviewer =
        data.kind === "expense"
          ? await readUser(tx, db, C.text(data.reviewerUid, "검토자", 128))
          : null;
      const approverUids = C.validateRoute(
        data.kind,
        actor,
        reviewer,
        approver,
      );
      const files = data.files || [];
      C.check(
        Array.isArray(files) && files.length <= 5,
        "첨부는 최대 5개입니다.",
        "invalid-argument",
      );
      const attachments = {};
      files.forEach((f, i) => {
        attachments["a" + i] = attachment(
          f,
          `business-document-files/${requestId}/a${i}`,
        );
      });
      C.check(
        Object.values(attachments).reduce((n, f) => n + f.size, 0) <= 31457280,
        "첨부 합계는 30MB 이하입니다.",
      );
      if (data.kind === "expense")
        C.check(files.length > 0, "지출결의서는 증빙을 첨부하세요.");
      let revisedFrom = null;
      if (data.revisedFrom) {
        const old = await tx.get(
          db.collection(COLLECTION).doc(id(data.revisedFrom)),
        );
        C.check(
          old.exists &&
            old.data().requesterUid === uid &&
            ["rejected", "withdrawn", "cancelled"].includes(old.data().status),
          "반려·회수·취소한 본인 문서만 재작성할 수 있습니다.",
        );
        revisedFrom = old.id;
      }
      const year = new Date(now + 9 * 3600000).getUTCFullYear();
      const countRef = db
        .collection("business_document_sequences")
        .doc(String(year));
      const counter = await tx.get(countRef);
      const seq = (counter.data()?.value || 0) + 1;
      doc = {
        schemaVersion: 4,
        kind: data.kind,
        number: `YJ-${data.kind.toUpperCase()}-${year}-${String(seq).padStart(6, "0")}`,
        details,
        requesterUid: uid,
        requesterName: actor.name,
        requesterRole: actor.role,
        approverUids,
        approverNames:
          data.kind === "expense"
            ? [reviewer.name, approver.name]
            : [approver.name],
        status: "draft",
        step: 0,
        attachments,
        createdAt: now,
        updatedAt: now,
        paidAmount: 0,
        paymentStatus:
          data.kind === "expense"
            ? details.settlementType === "prepaid"
              ? "not_required"
              : "unpaid"
            : null,
        settledAt: null,
        completedAt: null,
        allocatedAmount: 0,
        revisedFrom,
      };
      tx.set(countRef, { value: seq });
      tx.create(ref, doc);
      result = { ...result, document: doc };
    } else {
      C.check(
        snap.exists && C.canRead(doc, actor),
        "문서 접근 권한이 없습니다.",
        "permission-denied",
      );
      if (action === "submit") {
        C.check(
          doc.requesterUid === uid && doc.status === "draft",
          "본인의 작성 중 문서만 제출할 수 있습니다.",
          "permission-denied",
        );
        const approver = await readUser(
          tx,
          db,
          doc.approverUids[doc.approverUids.length - 1],
        );
        const reviewer =
          doc.kind === "expense"
            ? await readUser(tx, db, doc.approverUids[0])
            : null;
        C.validateRoute(doc.kind, actor, reviewer, approver);
        await verify(doc.attachments);
        if (doc.kind === "expense" && doc.details.purchaseId) {
          const purchaseRef = db
            .collection(COLLECTION)
            .doc(id(doc.details.purchaseId));
          const ps = await tx.get(purchaseRef);
          const purchase = ps.data();
          C.check(
            purchase &&
              purchase.kind === "purchase" &&
              purchase.status === "approved" &&
              C.canRead(purchase, actor),
            "승인된 접근 가능 구매요청만 연결할 수 있습니다.",
          );
          C.check(
            (purchase.allocatedAmount || 0) + doc.details.amount <=
              purchase.details.amount,
            "구매 승인금액보다 연결 지출 합계가 큽니다.",
          );
          extra.purchase = {
            ref: purchaseRef,
            value: (purchase.allocatedAmount || 0) + doc.details.amount,
          };
          patch.purchaseReserved = true;
        }
        patch = {
          ...patch,
          status: "pending",
          submittedAt: now,
          updatedAt: now,
        };
      } else if (["approve", "reject", "withdraw"].includes(action)) {
        patch = C.transition(doc, actor, action, data.reason, now);
        if (
          ["rejected", "withdrawn"].includes(patch.status) &&
          doc.purchaseReserved
        ) {
          const pr = db.collection(COLLECTION).doc(id(doc.details.purchaseId));
          const ps = await tx.get(pr);
          C.check(
            ps.exists && (ps.data().allocatedAmount || 0) >= doc.details.amount,
            "구매 연결 금액을 확인해야 합니다.",
          );
          extra.purchase = {
            ref: pr,
            value: ps.data().allocatedAmount - doc.details.amount,
          };
          patch.purchaseReserved = false;
        }
      } else if (action === "cancelApproved") {
        C.check(
          actor.role === "admin" &&
            actor.uid !== doc.requesterUid &&
            doc.status === "approved",
          "작성자와 다른 관리자만 승인 문서를 취소할 수 있습니다.",
          "permission-denied",
        );
        C.check(
          !doc.paidAmount &&
            !doc.settledAt &&
            !doc.completedAt &&
            !doc.allocatedAmount,
          "지급·정산·처리 완료 또는 연결 지출이 있는 문서는 취소할 수 없습니다.",
        );
        patch = {
          status: "cancelled",
          cancellationReason: C.text(data.reason, "취소 사유", 500),
          cancelledAt: now,
          updatedAt: now,
        };
        if (doc.purchaseReserved) {
          const pr = db.collection(COLLECTION).doc(id(doc.details.purchaseId));
          const ps = await tx.get(pr);
          C.check(
            ps.exists && (ps.data().allocatedAmount || 0) >= doc.details.amount,
            "구매 연결 금액을 확인해야 합니다.",
          );
          extra.purchase = {
            ref: pr,
            value: ps.data().allocatedAmount - doc.details.amount,
          };
          patch.purchaseReserved = false;
        }
      } else if (action === "preparePayment") {
        C.payment(doc, actor, data, now);
        const paymentId = id(data.paymentId);
        const paymentRef = ref.collection("payments").doc(paymentId);
        const existing = await tx.get(paymentRef);
        C.check(
          !existing.exists,
          "이미 등록된 지급 요청입니다.",
          "already-exists",
        );
        const proof = attachment(
          data.proof,
          `business-payment-files/${requestId}/${paymentId}/proof`,
        );
        const paymentDraft = {
          status: "draft",
          actorUid: uid,
          amount: data.amount,
          paidDate: data.paidDate,
          reference: C.text(data.reference, "이체·지급 식별번호", 120),
          proof,
          createdAt: now,
        };
        extra.payment = { ref: paymentRef, create: paymentDraft };
        result = { ...result, paymentId, proof };
      } else if (action === "pay") {
        const paymentId = id(data.paymentId);
        const paymentRef = ref.collection("payments").doc(paymentId);
        const ps = await tx.get(paymentRef);
        const p = ps.data();
        C.check(
          p && p.status === "draft" && p.actorUid === uid,
          "본인이 준비한 미처리 지급만 기록할 수 있습니다.",
        );
        patch = C.payment(doc, actor, p, now);
        await verify({ proof: p.proof });
        const receiptRef = db
          .collection("business_payment_references")
          .doc(hash(p.reference.normalize("NFKC").trim().toUpperCase()));
        const receipt = await tx.get(receiptRef);
        C.check(
          !receipt.exists,
          "이미 기록된 이체·지급 식별번호입니다.",
          "already-exists",
        );
        extra.receipt = {
          ref: receiptRef,
          data: { documentId: requestId, paymentId, at: now },
        };
        extra.payment = {
          ref: paymentRef,
          update: {
            status: "recorded",
            recordedAt: now,
            actorName: actor.name,
          },
        };
      } else if (action === "settle") {
        C.check(
          ["admin", "accounting"].includes(actor.role) &&
            doc.kind === "expense" &&
            doc.status === "approved" &&
            doc.details.settlementType === "prepaid" &&
            !doc.settledAt,
          "승인된 기지급 문서를 회계 담당자가 정산해야 합니다.",
        );
        patch = {
          settledAt: now,
          settledBy: uid,
          settlementNote: C.text(data.reason, "정산 확인 내용", 500),
          updatedAt: now,
        };
      } else if (action === "complete") {
        C.check(
          doc.status === "approved" &&
            doc.kind !== "expense" &&
            !doc.completedAt,
          "승인된 미완료 문서만 처리할 수 있습니다.",
        );
        C.check(
          actor.role === "admin" ||
            (doc.requesterUid === uid && doc.kind !== "leave"),
          "처리 완료를 기록할 권한이 없습니다.",
          "permission-denied",
        );
        patch = {
          completedAt: now,
          completedBy: uid,
          completionNote: C.text(data.reason, "처리 결과", 1000),
          updatedAt: now,
        };
      } else
        throw new C.DocumentError(
          "invalid-argument",
          "지원하지 않는 작업입니다.",
        );
      if (extra.purchase)
        tx.update(extra.purchase.ref, {
          allocatedAmount: extra.purchase.value,
          updatedAt: now,
        });
      if (extra.payment?.create)
        tx.create(extra.payment.ref, extra.payment.create);
      if (extra.payment?.update)
        tx.update(extra.payment.ref, extra.payment.update);
      if (extra.receipt) tx.create(extra.receipt.ref, extra.receipt.data);
      if (Object.keys(patch).length) tx.update(ref, patch);
      result = { ...result, status: patch.status || doc.status };
    }
    tx.create(eventRef, {
      action,
      actorUid: uid,
      actorName: actor.name,
      actorRole: actor.role,
      at: now,
      reason: String(data.reason || "").slice(0, 1000),
      fingerprint,
      result,
    });
    return result;
  });
}
exports.businessDocument = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    try {
      return await handle(request);
    } catch (error) {
      if (error instanceof C.DocumentError)
        throw new HttpsError(error.code, error.message);
      console.error("businessDocument failed", { code: error?.code });
      throw new HttpsError(
        "internal",
        "처리를 완료하지 못했습니다. 같은 요청으로 다시 시도하세요.",
      );
    }
  },
);
exports.handle = handle;
