(function () {
  "use strict";
  const root = document.getElementById("yjBusinessDocuments");
  if (!root) return;
  const kinds = {
    expense: "지출결의서",
    purchase: "구매·수리 요청서",
    leave: "휴가·근태 신청서",
    general: "일반 품의서",
    quality: "생산·품질 예외처리서",
  };
  const status = {
    draft: "작성 중",
    pending: "결재 대기",
    approved: "승인 완료",
    rejected: "반려",
    withdrawn: "회수",
    cancelled: "승인 취소",
  };
  const paymentLabels = {
    unpaid: "지급 전",
    partial: "일부 지급",
    paid: "지급 완료",
    not_required: "지급 불필요",
  };
  const mime = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    csv: "text/csv",
  };
  const fields = {
    expense: [
      [
        "settlementType",
        "처리 유형",
        [
          "vendor:거래처 지급 요청",
          "reimbursement:직원 경비 정산",
          "prepaid:법인카드·기지급 정리",
        ],
      ],
      [
        "category",
        "지출 구분",
        [
          "material:자재",
          "outsourcing:외주",
          "general:일반경비",
          "entertainment:접대",
          "other:기타",
        ],
      ],
      ["supplyAmount", "공급가액 (원)", "number"],
      ["taxAmount", "부가세 (원)", "number"],
      ["payee", "지급 대상", "text"],
      ["transactionDate", "거래일", "date"],
      ["plannedDate", "지급 요청일", "date"],
      [
        "paymentMethod",
        "지급 수단",
        ["bank_transfer:계좌이체", "corporate_card:법인카드", "cash:현금"],
      ],
      ["purchaseId", "연결할 승인 구매요청 (선택)", "purchase"],
      ["orderReference", "관련 주문번호 (선택)", "text"],
    ],
    purchase: [
      ["category", "요청 구분", ["purchase:구매", "repair:수리"]],
      ["item", "품목·수리 대상", "text"],
      ["quantity", "수량", "number"],
      ["amount", "예상 총액 (원)", "number"],
      ["neededDate", "필요일", "date"],
      ["vendor", "견적 거래처 (선택)", "text"],
    ],
    leave: [
      [
        "category",
        "근태 구분",
        ["annual:연차", "half:반차", "outing:외출", "other:기타"],
      ],
      ["startDate", "시작일", "date"],
      ["endDate", "종료일", "date"],
      ["hours", "신청 시간", "number"],
      ["handover", "업무 인수인계", "textarea"],
    ],
    general: [
      ["effectiveDate", "시행일", "date"],
      ["amount", "예상 비용 (원, 없으면 0)", "number"],
    ],
    quality: [
      ["orderReference", "관련 주문번호", "text"],
      [
        "category",
        "예외 구분",
        ["defect:불량", "rework:재작업", "scrap:폐기", "delay:납기 지연"],
      ],
      ["quantity", "대상 수량", "number"],
      ["actionPlan", "처리안", "textarea"],
      ["impact", "비용·납기 영향", "textarea"],
    ],
  };
  const state = {
    key: "",
    epoch: 0,
    uid: "",
    user: null,
    rows: [],
    users: [],
    busy: false,
    draft: null,
    selected: null,
    revise: null,
    operations: new Map(),
    loaded: false,
    view: "create",
  };
  const uuid = () => crypto.randomUUID();
  const money = (n) => Number(n || 0).toLocaleString("ko-KR") + "원";
  function el(tag, text, cls) {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }
  function button(label, fn) {
    const b = el("button", label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  root.innerHTML =
    '<div class="yb-header"><div><p class="yb-eyebrow">YJ FLOW DOCUMENT WORKSPACE</p><h3>문서 작성·결재·지급을 한곳에서 처리합니다</h3><p>신규 업무는 표준 문서 5종으로 작성하고, 결재 상태와 실제 처리 결과를 함께 확인합니다.</p></div><button type="button" id="ybRefresh">새로고침</button></div>' +
    '<nav class="yb-tabs" aria-label="문서 업무 구분"><button type="button" data-yb-view="create">새 문서 작성</button><button type="button" data-yb-view="my">내 문서</button><button type="button" data-yb-view="inbox">결재함</button><button type="button" data-yb-view="payments">지급관리</button><button type="button" data-yb-view="all">전체 문서</button></nav>' +
    '<div class="yb-summary"><div><span>내 문서</span><strong id="ybMetricMine">0</strong></div><div><span>결재 대기</span><strong id="ybMetricPending">0</strong></div><div><span>반려</span><strong id="ybMetricRejected">0</strong></div><div><span>지급 대기</span><strong id="ybMetricPayment">0</strong></div></div>' +
    '<p id="ybMessage" role="status" aria-live="polite"></p><div class="yb-layout"><form id="ybForm"><fieldset id="ybFieldset"><h4>새 문서 작성</h4><div id="ybCommon"></div><div id="ybFields" class="yb-grid"></div><div id="ybRoute" class="yb-grid"></div><label>첨부파일 (최대 5개, 각 10MB·합계 30MB)<input id="ybFiles" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.xlsx,.csv"></label><p class="yb-help">지출은 증빙 필수 · 구매·수리는 견적 첨부 권장</p><button type="submit" class="yb-primary">저장하고 결재 요청</button><button type="button" id="ybNew">새 양식</button></fieldset></form><section id="ybRecords"><div class="yb-toolbar"><div><h4 id="ybListTitle">내 문서</h4><p id="ybListHelp" class="yb-help">작성한 표준 문서를 확인합니다.</p></div><label>문서 종류<select id="ybFilter"><option value="all">전체</option></select></label></div><div id="ybList"></div><div id="ybDetail"></div></section></div>';
  const $ = (id) => document.getElementById(id);
  const form = $("ybForm");
  const views = ["create", "my", "inbox", "payments", "all"];
  const viewCopy = {
    create: ["최근 작성 문서", "새 문서를 작성하면서 최근 기록을 함께 확인합니다."],
    my: ["내 문서", "내가 작성한 표준 문서와 처리 상태입니다."],
    inbox: ["결재함", "현재 내가 검토하거나 승인해야 하는 문서입니다."],
    payments: ["지급관리", "승인 후 지급 전이거나 일부 지급된 지출결의입니다."],
    all: ["전체 문서", "권한 범위에서 확인할 수 있는 표준 문서 전체입니다."],
  };
  function message(s, error = false) {
    $("ybMessage").textContent = s;
    $("ybMessage").className = error ? "yb-error" : "yb-message";
  }
  function field(parent, key, label, type, value) {
    const wrap = el("label", label);
    let n;
    if (Array.isArray(type) || type === "purchase") {
      n = el("select");
      const opts =
        type === "purchase"
          ? [
              ":연결 안 함",
              ...state.rows
                .filter((d) => d.kind === "purchase" && d.status === "approved")
                .map((d) => d.id + ":" + d.number + " · " + d.details.title),
            ]
          : type;
      for (const o of opts) {
        const i = o.indexOf(":");
        const option = el("option", o.slice(i + 1));
        option.value = o.slice(0, i);
        n.append(option);
      }
    } else {
      n = el(type === "textarea" ? "textarea" : "input");
      if (type !== "textarea") n.type = type;
      if (type === "number") {
        n.min = "0";
        n.step = ["quantity", "hours"].includes(key) ? "any" : "1";
      }
      n.maxLength = type === "textarea" ? 2000 : 300;
    }
    n.name = key;
    n.id = "yb-" + key;
    if (value !== undefined) n.value = value;
    wrap.append(n);
    parent.append(wrap);
    return n;
  }
  const type = field(
    $("ybCommon"),
    "kind",
    "문서 종류",
    Object.entries(kinds).map(([k, v]) => k + ":" + v),
  );
  field($("ybCommon"), "title", "제목", "text");
  field(
    $("ybCommon"),
    "reason",
    "요청 내용·사유 (휴가는 인수인계 중심)",
    "textarea",
  );
  for (const [k, v] of Object.entries(kinds)) {
    const o = el("option", v);
    o.value = k;
    $("ybFilter").append(o);
  }
  function route() {
    const target = $("ybRoute");
    target.replaceChildren();
    const final = [
      ":최종 승인자 선택",
      ...state.users
        .filter((u) => u.role === "admin" && u.uid !== state.uid)
        .map((u) => u.uid + ":" + u.name),
    ];
    if (type.value === "expense")
      field(target, "reviewerUid", "회계 검토자 (본인·최종 승인자 제외)", [
        ":검토자 선택",
        ...state.users
          .filter((u) => u.uid !== state.uid)
          .map(
            (u) =>
              u.uid +
              ":" +
              u.name +
              " · " +
              (u.role === "admin" ? "관리자" : "회계"),
          ),
      ]);
    field(target, "approverUid", "최종 승인자", final);
  }
  function renderFields() {
    $("ybFields").replaceChildren();
    for (const f of fields[type.value]) field($("ybFields"), ...f);
    route();
  }
  type.addEventListener("change", () => {
    state.draft = null;
    state.revise = null;
    renderFields();
  });
  renderFields();
  function keyNow() {
    const a = window.auth?.currentUser;
    const u = window.yjGetCurrentUser?.();
    const matches =
      u &&
      [u.auth_uid, u.uid, u.id].filter(Boolean).every((id) => id === a?.uid);
    return a && u?.status === "active" && matches
      ? { key: a.uid + "|" + u.role, uid: a.uid, user: u }
      : null;
  }
  function sync() {
    const current = keyNow();
    const key = current?.key || "";
    if (key !== state.key) {
      state.key = key;
      state.epoch++;
      state.uid = current?.uid || "";
      state.user = current?.user || null;
      state.rows = [];
      state.users = [];
      state.loaded = false;
      state.busy = false;
      state.draft = null;
      state.selected = null;
      state.revise = null;
      state.operations.clear();
      state.view = "create";
      $("ybList").replaceChildren();
      $("ybDetail").replaceChildren();
      form.reset();
      renderFields();
      renderWorkspace();
      message(
        key
          ? "표준 문서를 불러오려면 새로고침하세요."
          : "승인된 개인 계정으로 로그인하세요.",
      );
    }
    $("ybFieldset").disabled = !state.uid || state.busy;
    return !!state.uid;
  }
  function guard(epoch) {
    sync();
    if (epoch !== state.epoch || !state.uid)
      throw new Error("계정이 변경되어 처리를 중단했습니다.");
  }
  async function api(data, epoch) {
    guard(epoch);
    const call = window.firebase
      .app()
      .functions("asia-northeast3")
      .httpsCallable("businessDocument");
    const r = await call(data);
    guard(epoch);
    return r.data;
  }
  function operation(data) {
    const key = JSON.stringify(data);
    if (!state.operations.has(key)) state.operations.set(key, uuid());
    return { ...data, operationId: state.operations.get(key) };
  }
  async function run(fn) {
    if (!sync() || state.busy) return;
    const epoch = state.epoch;
    state.busy = true;
    $("ybFieldset").disabled = true;
    try {
      await fn(epoch);
    } catch (e) {
      if (epoch === state.epoch) {
        if (
          state.draft &&
          !state.draft.persisted &&
          [
            "functions/invalid-argument",
            "functions/failed-precondition",
            "functions/permission-denied",
          ].includes(e.code)
        )
          state.draft = null;
        const missing = [
          "functions/not-found",
          "functions/unavailable",
        ].includes(e.code);
        message(
          missing
            ? "표준 문서 서비스에 연결하지 못했습니다. 배포·연결 상태를 확인하세요."
            : e.message,
          true,
        );
      }
    } finally {
      if (epoch === state.epoch) {
        state.busy = false;
        $("ybFieldset").disabled = !state.uid;
      }
    }
  }
  async function load(epoch) {
    const [a, b] = await Promise.all([
      api({ action: "list" }, epoch),
      api({ action: "directory" }, epoch),
    ]);
    state.rows = a.documents;
    state.users = b.users;
    state.loaded = true;
    const selections = {
      reviewerUid: $("yb-reviewerUid")?.value,
      approverUid: $("yb-approverUid")?.value,
    };
    route();
    for (const [k, v] of Object.entries(selections)) {
      if ($("yb-" + k)) $("yb-" + k).value = v || "";
    }
    const purchase = $("yb-purchaseId");
    if (purchase) {
      const selected = purchase.value;
      const holder = purchase.parentElement;
      const replacement = el("div");
      field(
        replacement,
        "purchaseId",
        "연결할 승인 구매요청 (선택)",
        "purchase",
        selected,
      );
      holder.replaceWith(replacement.firstChild);
    }
    renderWorkspace();
    message(
      a.capped
        ? "조회 상한에 도달했습니다. 목록은 일부 자료이며 전체 합계가 아닙니다."
        : "표준 문서 " + state.rows.length + "건을 확인했습니다.",
    );
  }
  $("ybRefresh").onclick = () => run(load);
  $("ybFilter").onchange = renderList;
  root.querySelectorAll("[data-yb-view]").forEach((tab) => {
    tab.addEventListener("click", () => setView(tab.dataset.ybView));
  });
  $("ybNew").onclick = () => {
    state.draft = null;
    state.revise = null;
    form.reset();
    renderFields();
    message(
      "새 문서를 작성합니다. 저장된 작성 중 문서는 목록에서 확인할 수 있습니다.",
    );
  };
  function isFinance() {
    return ["admin", "accounting"].includes(state.user?.role);
  }
  function visibleRows() {
    let rows = state.rows;
    if (["create", "my"].includes(state.view))
      rows = rows.filter((d) => d.requesterUid === state.uid);
    else if (state.view === "inbox")
      rows = rows.filter(
        (d) => d.status === "pending" && d.approverUids?.[d.step] === state.uid,
      );
    else if (state.view === "payments")
      rows = isFinance()
        ? rows.filter(
            (d) =>
              d.kind === "expense" &&
              d.status === "approved" &&
              ["unpaid", "partial"].includes(d.paymentStatus),
          )
        : [];
    return rows.filter(
      (d) => $("ybFilter").value === "all" || d.kind === $("ybFilter").value,
    );
  }
  function setView(view) {
    state.view = views.includes(view) ? view : "my";
    form.hidden = state.view !== "create";
    root.querySelectorAll("[data-yb-view]").forEach((tab) => {
      const active = tab.dataset.ybView === state.view;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-current", active ? "page" : "false");
    });
    const copy = viewCopy[state.view];
    $("ybListTitle").textContent = copy[0];
    $("ybListHelp").textContent = copy[1];
    renderList();
  }
  function renderMetrics() {
    const actionable = state.rows.filter(
      (d) => d.status === "pending" && d.approverUids?.[d.step] === state.uid,
    );
    const rejected = state.rows.filter((d) => d.status === "rejected");
    const payments = state.rows.filter(
      (d) =>
        d.kind === "expense" &&
        d.status === "approved" &&
        ["unpaid", "partial"].includes(d.paymentStatus),
    );
    const mine = state.rows.filter((d) => d.requesterUid === state.uid);
    $("ybMetricMine").textContent = mine.length;
    $("ybMetricPending").textContent = actionable.length;
    $("ybMetricRejected").textContent = rejected.length;
    $("ybMetricPayment").textContent = isFinance() ? payments.length : 0;
    const set = (id, value) => {
      const node = document.getElementById(id);
      if (node) node.textContent = value;
    };
    set("pcHubDocGlancePending", actionable.length);
    set("pcHubDocGlanceRejected", rejected.length);
    set("pcHubDocGlancePayment", isFinance() ? payments.length : 0);
    set(
      "pcHubDocGlanceTotal",
      `${actionable.length + rejected.length + (isFinance() ? payments.length : 0)}건`,
    );
    const stateNode = document.getElementById("pcHubDocGlanceState");
    if (stateNode)
      stateNode.textContent = state.loaded
        ? "표준 문서 기준 · 기존 문서는 보관함에서 조회"
        : "표준 문서 조회 전";
    renderApprovalInbox(actionable);
  }
  function renderApprovalInbox(rows) {
    const host = document.getElementById("yjUnifiedApprovalInbox");
    if (!host) return;
    host.replaceChildren();
    const header = el("div", undefined, "yb-inbox-header");
    const copy = el("div");
    copy.append(
      el("p", "STANDARD DOCUMENT APPROVAL", "yb-eyebrow"),
      el("h3", "통합 결재함"),
      el("p", "표준 문서 5종의 검토·승인 대상을 한곳에서 처리합니다."),
    );
    const open = button("전체 결재함 열기", () => {
      window.switchPCTab?.("docbox");
      setView("inbox");
    });
    header.append(copy, open);
    host.append(header);
    const list = el("div", undefined, "yb-inbox-list");
    if (!rows.length) list.append(el("p", "현재 처리할 표준 문서가 없습니다."));
    rows.slice(0, 8).forEach((d) => {
      const row = button("", () => {
        window.switchPCTab?.("docbox");
        setView("inbox");
        run((epoch) => detail(d.id, epoch));
      });
      row.className = "yb-row";
      row.append(
        el("strong", d.details.title),
        el("span", `${d.number} · ${kinds[d.kind]} · ${d.requesterName}`),
        el("span", "결재 대기"),
      );
      list.append(row);
    });
    host.append(list);
  }
  function renderWorkspace() {
    setView(state.view);
    renderMetrics();
  }
  function renderList() {
    const list = $("ybList");
    list.replaceChildren();
    const rows = visibleRows();
    if (!rows.length) list.append(el("p", "표시할 문서가 없습니다."));
    for (const d of rows) {
      const b = button("", () => run((e) => detail(d.id, e)));
      b.className = "yb-row";
      b.append(
        el("strong", d.details.title),
        el("span", d.number + " · " + kinds[d.kind]),
        el(
          "span",
          status[d.status] +
            (d.paymentStatus ? " · " + paymentLabels[d.paymentStatus] : ""),
        ),
      );
      list.append(b);
    }
  }
  function pair(parent, label, value) {
    const row = el("div", undefined, "yb-pair");
    row.append(el("dt", label), el("dd", String(value ?? "-")));
    parent.append(row);
  }
  async function download(file, epoch) {
    guard(epoch);
    const result = await window.yjDownloadAttachment(
      file.storagePath,
      file.name,
    );
    guard(epoch);
    if (!result.ok)
      throw new Error(window.yjAttachmentDownloadMessage(result.code));
  }
  function fileInfo(f) {
    const ext = f.name.split(".").pop().toLowerCase();
    if (!mime[ext]) throw new Error("PDF·이미지·XLSX·CSV 파일을 선택하세요.");
    return { name: f.name, size: f.size, contentType: mime[ext] };
  }
  async function upload(file, meta, epoch) {
    guard(epoch);
    const r = window.firebase.storage().ref(meta.storagePath);
    try {
      const m = await r.getMetadata();
      guard(epoch);
      if (Number(m.size) === meta.size && m.contentType === meta.contentType)
        return;
      throw new Error("이미 등록된 첨부 정보가 다릅니다.");
    } catch (e) {
      if (e.code !== "storage/object-not-found") throw e;
    }
    guard(epoch);
    await r.put(file, { contentType: meta.contentType });
    guard(epoch);
  }
  async function detail(id, epoch) {
    const r = await api({ action: "detail", id }, epoch);
    state.selected = r;
    const d = r.document;
    const box = $("ybDetail");
    box.replaceChildren();
    box.append(
      el("h4", d.details.title),
      el("p", d.number + " · " + status[d.status]),
    );
    const dl = el("dl");
    pair(dl, "문서 종류", kinds[d.kind]);
    pair(dl, "작성자", d.requesterName);
    pair(dl, "사유", d.details.reason);
    for (const [key, label, t] of fields[d.kind]) {
      let val = d.details[key];
      if (Array.isArray(t)) {
        const found = t.find((o) => o.split(":")[0] === val);
        val = found?.slice(found.indexOf(":") + 1) || val;
      }
      if (["amount", "supplyAmount", "taxAmount"].includes(key))
        val = money(val);
      pair(dl, label, val);
    }
    pair(dl, "결재선", d.approverNames.join(" → "));
    if (d.revisedFrom) pair(dl, "이전 문서 ID", d.revisedFrom);
    if (d.kind === "expense") {
      pair(dl, "총액", money(d.details.amount));
      pair(dl, "지급 상태", paymentLabels[d.paymentStatus]);
      pair(
        dl,
        "지급액 / 잔액",
        money(d.paidAmount) +
          " / " +
          money(
            d.details.settlementType === "prepaid"
              ? 0
              : d.details.amount - d.paidAmount,
          ),
      );
      if (d.details.settlementType === "prepaid")
        pair(dl, "증빙 정산", d.settledAt ? "정산 완료" : "정산 확인 전");
    }
    if (d.completedAt) pair(dl, "처리 결과", d.completionNote);
    box.append(dl);
    for (const a of Object.values(d.attachments)) {
      box.append(button("첨부: " + a.name, () => run((e) => download(a, e))));
    }
    const actions = el("div", undefined, "yb-actions");
    box.append(actions);
    async function act(action, reason) {
      await api(operation({ action, id, reason: reason || "" }), epoch);
      await load(epoch);
      await detail(id, epoch);
      message("처리를 완료했습니다.");
    }
    if (d.status === "draft" && d.requesterUid === state.uid) {
      for (const a of Object.values(d.attachments)) {
        const input = field(
          actions,
          "retry-" + a.storagePath.split("/").pop(),
          "미완료 첨부 재업로드: " + a.name,
          "file",
        );
        input.onchange = () =>
          run(async (e) => {
            const f = input.files[0];
            if (!f) return;
            const m = fileInfo(f);
            if (
              m.name !== a.name ||
              m.size !== a.size ||
              m.contentType !== a.contentType
            )
              throw new Error(
                "등록한 파일과 이름·크기·형식이 일치해야 합니다.",
              );
            await upload(f, a, e);
            message("첨부 업로드 완료");
          });
      }
      actions.append(button("결재 요청", () => run(() => act("submit"))));
    }
    if (d.status === "pending" && d.requesterUid === state.uid)
      actions.append(button("회수", () => run(() => act("withdraw"))));
    if (d.status === "pending" && d.approverUids[d.step] === state.uid) {
      const note = field(
        actions,
        "decisionReason",
        "결재 의견 (반려 시 필수)",
        "textarea",
      );
      actions.append(
        button("승인", () => run(() => act("approve", note.value))),
        button("반려", () => run(() => act("reject", note.value))),
      );
    }
    if (
      ["rejected", "withdrawn", "cancelled"].includes(d.status) &&
      d.requesterUid === state.uid
    ) {
      actions.append(
        button("수정하여 새 문서로 재상신", () => {
          state.draft = null;
          state.revise = id;
          type.value = d.kind;
          renderFields();
          for (const [k, v] of Object.entries(d.details)) {
            if ($("yb-" + k)) $("yb-" + k).value = v;
          }
          message(
            "이전 문서 이력은 보존됩니다. 결재자와 첨부를 다시 확인하세요.",
          );
          form.scrollIntoView({ behavior: "smooth" });
        }),
      );
    }
    if (d.status === "approved" && d.kind === "purchase") {
      actions.append(
        button("이 구매요청으로 지출결의 작성", () => {
          state.draft = null;
          state.revise = null;
          type.value = "expense";
          renderFields();
          $("yb-title").value = d.details.title + " 대금 지급";
          $("yb-reason").value = "구매요청 " + d.number + "에 따른 지급";
          $("yb-purchaseId").value = id;
          $("yb-supplyAmount").value = d.details.amount;
          $("yb-taxAmount").value = 0;
          message("공급가액·부가세·실제 지급액을 증빙에 맞춰 확인하세요.");
          form.scrollIntoView({ behavior: "smooth" });
        }),
      );
    }
    if (
      d.status === "approved" &&
      state.user?.role === "admin" &&
      state.uid !== d.requesterUid &&
      !d.paidAmount &&
      !d.settledAt &&
      !d.completedAt &&
      !d.allocatedAmount
    ) {
      const note = field(
        actions,
        "cancelReason",
        "승인 취소 사유 (지급·처리 전만 가능)",
        "textarea",
      );
      actions.append(
        button("승인 취소", () => run(() => act("cancelApproved", note.value))),
      );
    }
    const finance = ["admin", "accounting"].includes(state.user?.role);
    if (d.status === "approved" && d.kind === "expense" && finance) {
      if (d.details.settlementType === "prepaid" && !d.settledAt) {
        const note = field(
          actions,
          "settlementNote",
          "증빙 정산 확인 내용",
          "textarea",
        );
        actions.append(
          button("정산 완료 기록", () => run(() => act("settle", note.value))),
        );
      } else if (
        d.details.settlementType !== "prepaid" &&
        d.paidAmount < d.details.amount
      ) {
        const payForm = el("div", undefined, "yb-payment");
        payForm.append(el("h4", "실제 지급 결과 기록"));
        const amount = field(
          payForm,
          "paymentAmount",
          "지급액 (원)",
          "number",
          d.details.amount - d.paidAmount,
        );
        const paidDate = field(payForm, "paidDate", "실제 지급일", "date");
        const reference = field(
          payForm,
          "paymentReference",
          "은행 이체번호 또는 고유 지급전표번호",
          "text",
        );
        const proof = field(payForm, "proof", "이체·지급 증빙", "file");
        let pending = null;
        payForm.append(
          button("지급 기록 저장", () =>
            run(async (e) => {
              if (!pending) {
                if (!proof.files[0]) throw new Error("지급 증빙을 첨부하세요.");
                pending = {
                  id: uuid(),
                  file: proof.files[0],
                  amount: Number(amount.value),
                  paidDate: paidDate.value,
                  reference: reference.value,
                };
              }
              const prep = await api(
                operation({
                  action: "preparePayment",
                  id,
                  paymentId: pending.id,
                  amount: pending.amount,
                  paidDate: pending.paidDate,
                  reference: pending.reference,
                  proof: fileInfo(pending.file),
                }),
                e,
              );
              await upload(pending.file, prep.proof, e);
              await api(
                operation({ action: "pay", id, paymentId: pending.id }),
                e,
              );
              await load(e);
              await detail(id, e);
              message("지급 기록을 저장했습니다. 실제 송금은 별도입니다.");
            }),
          ),
        );
        actions.append(payForm);
      }
    }
    if (
      d.status === "approved" &&
      d.kind !== "expense" &&
      !d.completedAt &&
      (state.user?.role === "admin" ||
        (d.requesterUid === state.uid && d.kind !== "leave"))
    ) {
      const note = field(
        actions,
        "completionNote",
        "실제 처리 결과 (근태는 반영 결과)",
        "textarea",
      );
      actions.append(
        button("처리 완료 기록", () => run(() => act("complete", note.value))),
      );
    }
    box.append(el("h4", "지급 이력"));
    for (const p of r.payments) {
      const line = el(
        "p",
        (p.status === "recorded" ? "기록 완료" : "증빙 등록 중") +
          " · " +
          p.paidDate +
          " · " +
          money(p.amount) +
          " · " +
          p.reference,
      );
      box.append(line);
      if (p.proof)
        box.append(
          button("지급 증빙 보기", () => run((e) => download(p.proof, e))),
        );
      if (p.status === "draft" && p.actorUid === state.uid) {
        const input = field(
          box,
          "resume-" + p.id,
          "지급 증빙 재업로드 (필요 시)",
          "file",
        );
        box.append(
          button("이 지급 기록 확정", () =>
            run(async (e) => {
              if (input.files[0]) {
                const m = fileInfo(input.files[0]);
                if (
                  m.name !== p.proof.name ||
                  m.size !== p.proof.size ||
                  m.contentType !== p.proof.contentType
                )
                  throw new Error("등록한 증빙과 다른 파일입니다.");
                await upload(input.files[0], p.proof, e);
              }
              await api(operation({ action: "pay", id, paymentId: p.id }), e);
              await load(e);
              await detail(id, e);
              message("지급 기록을 확정했습니다.");
            }),
          ),
        );
      }
    }
    box.append(el("h4", "처리 이력"));
    const labels = {
      create: "문서 작성",
      submit: "결재 요청",
      approve: "승인",
      reject: "반려",
      withdraw: "회수",
      preparePayment: "지급 증빙 준비",
      pay: "지급 기록",
      settle: "정산 완료",
      complete: "처리 완료",
      cancelApproved: "승인 취소",
    };
    for (const h of r.history)
      box.append(
        el(
          "p",
          new Date(h.at).toLocaleString("ko-KR") +
            " · " +
            h.actorName +
            " · " +
            (labels[h.action] || h.action) +
            (h.reason ? " · " + h.reason : ""),
        ),
      );
    if (r.capped)
      box.append(el("p", "이력은 최근 100건만 표시합니다.", "yb-error"));
    box.append(button("A4 인쇄 / PDF", () => print(r)));
  }
  function print(r) {
    const host = el("section", undefined, "yb-print");
    host.id = "ybPrint";
    host.append(el("h1", kinds[r.document.kind]), el("p", r.document.number));
    const copy = $("ybDetail").cloneNode(true);
    copy
      .querySelectorAll("button,input,textarea,select,.yb-actions")
      .forEach((n) => n.remove());
    copy.removeAttribute("id");
    host.append(copy);
    document.getElementById("ybPrint")?.remove();
    document.body.append(host);
    document.body.classList.add("yb-printing");
    const clean = () => {
      host.remove();
      document.body.classList.remove("yb-printing");
    };
    window.addEventListener("afterprint", clean, { once: true });
    window.print();
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    run(async (epoch) => {
      if (!state.loaded)
        throw new Error("먼저 새로고침하여 결재자를 확인하세요.");
      if (!state.draft) {
        const input = Object.fromEntries(
          [...form.elements]
            .filter((n) => n.name)
            .map((n) => [n.name, n.value]),
        );
        const details = { title: input.title, reason: input.reason };
        for (const [k, , t] of fields[type.value])
          details[k] = t === "number" ? Number(input[k]) : input[k] || "";
        const files = [...$("ybFiles").files];
        state.draft = {
          id: uuid(),
          kind: type.value,
          details,
          reviewerUid: input.reviewerUid || "",
          approverUid: input.approverUid || "",
          files,
          revisedFrom: state.revise,
        };
      }
      const d = state.draft;
      message("문서를 저장하고 첨부를 올리는 중입니다…");
      const r = await api(
        operation({
          action: "create",
          id: d.id,
          kind: d.kind,
          details: d.details,
          reviewerUid: d.reviewerUid,
          approverUid: d.approverUid,
          files: d.files.map(fileInfo),
          revisedFrom: d.revisedFrom,
        }),
        epoch,
      );
      d.persisted = true;
      for (let i = 0; i < d.files.length; i++)
        await upload(d.files[i], r.document.attachments["a" + i], epoch);
      await api(operation({ action: "submit", id: d.id }), epoch);
      state.draft = null;
      state.revise = null;
      form.reset();
      renderFields();
      try {
        await load(epoch);
        await detail(d.id, epoch);
        message("결재 요청이 완료됐습니다.");
      } catch (e) {
        guard(epoch);
        message(
          "결재 요청은 완료됐지만 목록을 갱신하지 못했습니다. 새로고침하세요.",
          true,
        );
      }
    });
  });
  // No persistent storage of financial data. Wipe every account generation, including A→B→A.
  let watchedAuth = null;
  function watchAuth() {
    const a = window.auth;
    if (a && a !== watchedAuth && a.onAuthStateChanged) {
      watchedAuth = a;
      a.onAuthStateChanged(() => {
        state.key = "auth-generation-reset";
        sync();
      });
    }
  }
  setInterval(() => {
    watchAuth();
    sync();
  }, 500);
  watchAuth();
  sync();
  window.YJBusinessDocuments = {
    refresh: () => run(load),
    setView,
    getRows: () => state.rows.slice(),
  };
})();
