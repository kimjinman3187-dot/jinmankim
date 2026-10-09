(function () {
  "use strict";
  const root = document.getElementById("yjBusinessDocuments");
  if (!root) return;
  const kinds = {
    expense: "지출결의서",
    purchase: "구매·수리 요청서",
    vendor_contract: "거래처·계약조건 승인서",
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
  function documentStatusLabel(document) {
    if (document?.kind === "expense" && document.erpExportStatus === "exported")
      return "ERP 이관 완료";
    if (document?.kind === "expense" && document.status === "approved")
      return "승인 완료 · ERP 이관 대기";
    if (document?.kind === "expense" && document.status === "pending")
      return document.step === 0 ? "회계 검토" : "최종 승인 대기";
    return status[document?.status] || document?.status || "-";
  }
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
      ["taxType", "과세 구분", ["taxable:과세", "exempt:면세", "zero_rated:영세"]],
      ["amount", "총액 (원)", "number"],
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
    vendor_contract: [
      ["partnerName", "거래처명", "text"],
      ["contractType", "계약 구분", ["supply:납품", "service:용역", "purchase:매입", "sales:매출", "nda:비밀유지", "other:기타"]],
      ["startDate", "계약 시작일", "date"],
      ["endDate", "계약 종료일", "date"],
      ["contractAmount", "계약금액 (원, 없으면 0)", "number"],
      ["paymentTerms", "대금·결제 조건", "textarea"],
      ["renewalTerms", "갱신·해지 조건 (선택)", "textarea"],
      ["ownerDepartment", "담당부서", "text"],
      ["riskNotes", "주요 위험사항 (선택)", "textarea"],
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
    notifications: [],
    busy: false,
    draft: null,
    selected: null,
    revise: null,
    editing: null,
    operations: new Map(),
    loaded: false,
    view: "create",
    loadFailed: false,
    directoryReady: false,
  };
  const uuid = () => crypto.randomUUID();
  const money = (n) => Number(n || 0).toLocaleString("ko-KR") + "원";
  const formatBytes = (value) => {
    const bytes = Number(value || 0);
    if (bytes < 1024) return bytes.toLocaleString("ko-KR") + "B";
    if (bytes < 1024 * 1024)
      return (bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0) + "KB";
    return (bytes / (1024 * 1024)).toFixed(1) + "MB";
  };
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
    '<div class="yb-header"><div><p class="yb-eyebrow">표준 문서 업무</p><h3>문서 작성·결재·지급을 한곳에서 처리합니다</h3><p>업무 카테고리별 표준 문서를 작성하고, 결재 상태와 실제 처리 결과를 함께 확인합니다.</p></div><button type="button" id="ybRefresh">새로고침</button></div>' +
    '<nav class="yb-tabs" aria-label="문서 업무 구분"><button type="button" data-yb-view="create">새 문서 작성</button><button type="button" data-yb-view="my">내 문서</button><button type="button" data-yb-view="inbox">결재함</button><button type="button" data-yb-view="payments">지급관리</button><button type="button" data-yb-view="all">전체 문서</button></nav>' +
    '<div class="yb-summary"><div><span>내 문서</span><strong id="ybMetricMine">0</strong></div><div><span>결재 대기</span><strong id="ybMetricPending">0</strong></div><div><span>반려</span><strong id="ybMetricRejected">0</strong></div><div><span>지급 대기</span><strong id="ybMetricPayment">0</strong></div></div>' +
    '<p id="ybMessage" role="status" aria-live="polite"></p><section id="ybNotifications" class="yb-notifications" aria-label="문서 알림"></section><div class="yb-layout"><form id="ybForm"><fieldset id="ybFieldset"><h4 id="ybFormTitle">새 문서 작성</h4><div id="ybDraftMeta" class="yb-draft-meta" aria-label="자동 입력 정보"></div><div id="ybCommon"></div><div id="ybFields" class="yb-grid"></div><div id="ybRoute" class="yb-grid"></div><label id="ybFileDrop" class="yb-file-drop">증빙 자료 첨부 <span>여기에 끌어놓거나 눌러서 선택 · 최대 5개, 각 3MB·합계 10MB</span><input id="ybFiles" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.xlsx,.csv"></label><div id="ybAttachmentState" class="yb-attachment-state" role="status" aria-live="polite"></div><label id="ybClearFilesLabel"><input id="ybClearFiles" type="checkbox"> 기존 첨부를 모두 제거</label><p id="ybAttachmentHelp" class="yb-help">무료 요금제 전용 보안 저장 · 지출은 증빙 필수 · 구매·수리는 견적 첨부 권장</p><button type="submit" name="intent" value="submit" class="yb-primary">저장하고 결재 요청</button><button type="submit" name="intent" value="draft">임시저장</button><button type="button" id="ybNew">새 양식</button></fieldset></form><section id="ybRecords"><div class="yb-toolbar"><div><h4 id="ybListTitle">내 문서</h4><p id="ybListHelp" class="yb-help">작성한 표준 문서를 확인합니다.</p></div><label>문서 종류<select id="ybFilter"><option value="all">전체</option></select></label></div><div id="ybList"></div><div id="ybDetail"></div></section></div>';
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
  function attachmentEntries(document) {
    return Object.entries(document?.attachments || {});
  }
  function renderFormAttachmentState(document, selectedFiles) {
    const host = $("ybAttachmentState");
    host.replaceChildren();
    host.className = "yb-attachment-state";
    const selected = [...(selectedFiles || [])];
    const entries = attachmentEntries(document);
    let title = "첨부 없음";
    let detail = "선택한 파일이 없습니다.";
    if (selected.length) {
      const total = selected.reduce((sum, file) => sum + file.size, 0);
      title = `저장 전 · ${selected.length}개`;
      detail =
        selected.map((file) => `${file.name} (${formatBytes(file.size)})`).join(", ") +
        ` · 합계 ${formatBytes(total)}`;
      host.classList.add("is-pending");
    } else if ($("ybClearFiles")?.checked && entries.length) {
      title = "제거 예정";
      detail = "저장하면 기존 첨부가 모두 제거됩니다.";
      host.classList.add("is-warning");
    } else if (entries.length) {
      const complete = entries.filter(
        ([slot]) => document.attachmentCompletion?.[slot] === true,
      ).length;
      title =
        complete === entries.length
          ? `저장·무결성 확인 완료 · ${complete}개`
          : `재업로드 필요 · ${entries.length - complete}개`;
      detail = entries
        .map(([, file]) => `${file.name} (${formatBytes(file.size)})`)
        .join(", ");
      host.classList.add(
        complete === entries.length ? "is-complete" : "is-warning",
      );
    }
    host.append(el("strong", title), el("span", detail));
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
  function chipField(parent, key, label, options, value) {
    const group = el("fieldset", undefined, "yb-chip-field");
    group.append(el("legend", label));
    const chips = el("div", undefined, "yb-chips");
    options.forEach((option, index) => {
      const split = option.indexOf(":");
      const optionValue = option.slice(0, split);
      const chip = el("label", undefined, "yb-chip");
      const input = el("input");
      input.type = "radio";
      input.name = key;
      input.value = optionValue;
      input.checked = value ? value === optionValue : index === 0;
      chip.append(input, el("span", option.slice(split + 1)));
      chips.append(chip);
    });
    group.append(chips);
    parent.append(group);
    return group;
  }
  function renderDraftMeta(document) {
    const meta = $("ybDraftMeta");
    meta.replaceChildren();
    [
      ["문서번호", document?.number || "저장 시 자동 발급"],
      ["작성일시", document?.createdAt ? printDate(document.createdAt) : "저장 시 기록"],
      ["작성자", document?.requesterName || state.user?.name || "로그인 계정 확인 중"],
    ].forEach(([label, value]) => {
      const item = el("div");
      item.append(el("span", label), el("strong", value));
      meta.append(item);
    });
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
    const target = $("ybFields");
    let related = null;
    for (const f of fields[type.value]) {
      const [key, label, control] = f;
      if (type.value === "expense" && key === "settlementType" && !isFinance())
        continue;
      if (type.value === "expense" && ["purchaseId", "orderReference"].includes(key)) {
        if (!related) {
          related = el("details", undefined, "yb-related");
          related.append(el("summary", "+ 관련 문서 추가"));
          target.append(related);
        }
        field(related, key, label, control);
      } else if (
        type.value === "expense" &&
        ["category", "taxType"].includes(key) &&
        Array.isArray(control)
      ) {
        chipField(target, key, label, control);
      } else {
        field(target, key, label, control);
      }
    }
    bindExpenseAmounts();
    route();
    renderDraftMeta(state.editing);
  }
  function selectedValue(name) {
    return form.querySelector(`[name="${name}"]:checked`)?.value || "";
  }
  function setFormValue(key, value) {
    const radios = form.querySelectorAll(`[name="${key}"][type="radio"]`);
    if (radios.length) {
      radios.forEach((input) => {
        input.checked = input.value === value;
      });
      return;
    }
    if ($("yb-" + key)) $("yb-" + key).value = value ?? "";
    if (["purchaseId", "orderReference"].includes(key) && value)
      $("yb-" + key)?.closest("details")?.setAttribute("open", "");
  }
  function calculateExpenseAmounts(source) {
    if (type.value !== "expense") return;
    const total = $("yb-amount");
    const supply = $("yb-supplyAmount");
    const tax = $("yb-taxAmount");
    if (!total || !supply || !tax) return;
    const taxType = selectedValue("taxType") || "taxable";
    const totalValue = Math.max(0, Math.trunc(Number(total.value) || 0));
    const supplyValue = Math.max(0, Math.trunc(Number(supply.value) || 0));
    if (source === "total") {
      const nextSupply = taxType === "taxable" ? Math.round(totalValue / 1.1) : totalValue;
      supply.value = String(nextSupply);
      tax.value = String(taxType === "taxable" ? totalValue - nextSupply : 0);
    } else {
      const nextTax = taxType === "taxable" ? Math.round(supplyValue * 0.1) : 0;
      tax.value = String(nextTax);
      total.value = String(supplyValue + nextTax);
    }
    tax.disabled = taxType !== "taxable";
  }
  function bindExpenseAmounts() {
    if (type.value !== "expense") return;
    const total = $("yb-amount");
    const supply = $("yb-supplyAmount");
    const tax = $("yb-taxAmount");
    if (!total || !supply || !tax) return;
    tax.readOnly = true;
    total.addEventListener("input", () => calculateExpenseAmounts("total"));
    supply.addEventListener("input", () => calculateExpenseAmounts("supply"));
    form.querySelectorAll('[name="taxType"]').forEach((input) =>
      input.addEventListener("change", () => calculateExpenseAmounts(total.value ? "total" : "supply")),
    );
    calculateExpenseAmounts(total.value ? "total" : "supply");
  }
  type.addEventListener("change", () => {
    state.draft = null;
    state.revise = null;
    state.editing = null;
    renderFields();
    renderFormAttachmentState(null);
  });
  renderFields();
  $("ybClearFilesLabel").hidden = true;
  renderFormAttachmentState(null);
  $("ybFiles").addEventListener("change", () => {
    const files = [...$("ybFiles").files];
    if (files.length) $("ybClearFiles").checked = false;
    renderFormAttachmentState(state.editing, files);
    $("ybAttachmentHelp").textContent = files.length
      ? "선택한 파일은 아직 저장 전입니다. 임시저장 또는 결재 요청을 완료해야 서버에 보관됩니다."
      : state.editing?.attachmentCount
        ? "파일 선택란이 비어 있어도 아래 저장 완료 표시가 있으면 기존 첨부는 유지됩니다."
        : "무료 요금제 전용 보안 저장 · 지출은 증빙 필수 · 구매·수리는 견적 첨부 권장";
  });
  ["dragenter", "dragover"].forEach((eventName) =>
    $("ybFileDrop").addEventListener(eventName, (event) => {
      event.preventDefault();
      $("ybFileDrop").classList.add("is-dragging");
    }),
  );
  ["dragleave", "drop"].forEach((eventName) =>
    $("ybFileDrop").addEventListener(eventName, (event) => {
      event.preventDefault();
      $("ybFileDrop").classList.remove("is-dragging");
    }),
  );
  $("ybFileDrop").addEventListener("drop", (event) => {
    if (!event.dataTransfer?.files?.length) return;
    $("ybFiles").files = event.dataTransfer.files;
    $("ybFiles").dispatchEvent(new Event("change", { bubbles: true }));
  });
  $("ybClearFiles").addEventListener("change", () => {
    if ($("ybClearFiles").checked) $("ybFiles").value = "";
    renderFormAttachmentState(state.editing, $("ybFiles").files);
  });
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
      state.notifications = [];
      state.loaded = false;
      state.loadFailed = false;
      state.directoryReady = false;
      state.busy = false;
      state.draft = null;
      state.selected = null;
      state.revise = null;
      state.editing = null;
      state.operations.clear();
      state.view = "create";
      $("ybList").replaceChildren();
      $("ybDetail").replaceChildren();
      form.reset();
      type.disabled = false;
      $("ybFormTitle").textContent = "새 문서 작성";
      $("ybClearFilesLabel").hidden = true;
      $("ybAttachmentHelp").textContent =
        "무료 요금제 전용 보안 저장 · 지출은 증빙 필수 · 구매·수리는 견적 첨부 권장";
      renderFormAttachmentState(null);
      renderFields();
      renderWorkspace();
      message(
        key
          ? "문서 화면에 들어오면 최신 자료를 자동으로 불러옵니다."
          : "승인된 개인 계정으로 로그인하세요.",
      );
    }
    $("ybFieldset").disabled =
      !state.uid || state.busy || state.loadFailed || (state.loaded && !state.directoryReady);
    return !!state.uid;
  }
  function guard(epoch) {
    sync();
    if (epoch !== state.epoch || !state.uid)
      throw new Error("계정이 변경되어 처리를 중단했습니다.");
  }
  async function api(data, epoch) {
    guard(epoch);
    if (!window.YJBusinessDocumentClient?.request)
      throw new Error("문서 기능을 준비하지 못했습니다. 새로고침 후 다시 시도하세요.");
    const r = await window.YJBusinessDocumentClient.request(data);
    guard(epoch);
    return r;
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
        state.loadFailed = !state.loaded;
        renderMetrics();
        const friendly = {
          "permission-denied": "현재 계정으로 문서에 접근할 수 없습니다.",
          unauthenticated: "개인 계정으로 다시 로그인하세요.",
          unavailable: "문서 저장소 연결이 원활하지 않습니다. 잠시 후 다시 시도하세요.",
        };
        message(
          friendly[String(e.code || "").replace(/^functions\//, "")] ||
            (e.message === "internal" ? "문서를 불러오지 못했습니다. 새로고침 후 다시 시도하세요." : e.message),
          true,
        );
      }
    } finally {
      if (epoch === state.epoch) {
        state.busy = false;
        $("ybFieldset").disabled =
          !state.uid || state.loadFailed || (state.loaded && !state.directoryReady);
      }
    }
  }
  async function load(epoch) {
    const [a, b, c] = await Promise.all([
      api({ action: "list" }, epoch),
      api({ action: "directory" }, epoch),
      api({ action: "notifications" }, epoch),
    ]);
    state.rows = a.documents;
    state.users = b.users;
    state.notifications = c.notifications;
    state.loaded = true;
    state.loadFailed = false;
    state.directoryReady = state.users.some(
      (u) => u.role === "admin" && u.uid !== state.uid,
    );
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
      !state.directoryReady
        ? "문서 조회는 가능하지만 결재자 명단이 아직 준비되지 않았습니다. 관리자에게 문서 결재 초기 설정을 요청하세요."
        : a.capped
          ? "조회 상한에 도달했습니다. 목록은 일부 자료이며 전체 합계가 아닙니다."
          : "표준 문서 " + state.rows.length + "건을 확인했습니다.",
      !state.directoryReady,
    );
    $("ybFieldset").disabled = !state.directoryReady;
  }
  $("ybRefresh").onclick = () => run(load);
  $("ybFilter").onchange = renderList;
  root.querySelectorAll("[data-yb-view]").forEach((tab) => {
    tab.addEventListener("click", () => setView(tab.dataset.ybView));
  });
  $("ybNew").onclick = () => {
    state.draft = null;
    state.revise = null;
    state.editing = null;
    form.reset();
    type.disabled = false;
    renderFields();
    $("ybFormTitle").textContent = "새 문서 작성";
    $("ybClearFilesLabel").hidden = true;
    $("ybAttachmentHelp").textContent =
      "무료 요금제 전용 보안 저장 · 지출은 증빙 필수 · 구매·수리는 견적 첨부 권장";
    renderFormAttachmentState(null);
    message(
      "새 문서를 작성합니다. 저장된 작성 중 문서는 목록에서 확인할 수 있습니다.",
    );
  };
  function isFinance() {
    return ["admin", "accounting"].includes(state.user?.role);
  }
  function applyRoleVisibility() {
    const finance = isFinance();
    const paymentTab = root.querySelector('[data-yb-view="payments"]');
    if (paymentTab) {
      paymentTab.hidden = !finance;
      paymentTab.setAttribute("aria-hidden", finance ? "false" : "true");
    }
    const paymentMetric = $("ybMetricPayment")?.parentElement;
    if (paymentMetric) paymentMetric.hidden = !finance;
    if (!finance && state.view === "payments") state.view = "my";
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
    const metric = (value) => (state.loadFailed ? "—" : value);
    $("ybMetricMine").textContent = metric(mine.length);
    $("ybMetricPending").textContent = metric(actionable.length);
    $("ybMetricRejected").textContent = metric(rejected.length);
    $("ybMetricPayment").textContent = metric(payments.length);
    const set = (id, value) => {
      const node = document.getElementById(id);
      if (node) node.textContent = value;
    };
    set("pcHubDocGlancePending", metric(actionable.length));
    set("pcHubDocGlanceRejected", metric(rejected.length));
    set("pcHubDocGlancePayment", metric(payments.length));
    set(
      "pcHubDocGlanceTotal",
      state.loadFailed ? "조회 실패" : `${actionable.length + rejected.length}건`,
    );
    const stateNode = document.getElementById("pcHubDocGlanceState");
    if (stateNode)
      stateNode.textContent = state.loaded
        ? "표준 문서 기준 · 기존 문서는 보관함에서 조회"
        : state.loadFailed
          ? "문서 조회 실패 · 새로고침 필요"
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
      el("p", "표준 문서 결재", "yb-eyebrow"),
      el("h3", "통합 결재함"),
      el("p", "표준 문서의 검토·승인 대상을 한곳에서 처리합니다."),
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
        el("strong", d.details.title || "제목 없는 작성 중 문서"),
        el("span", `${d.number} · ${kinds[d.kind]} · ${d.requesterName}`),
        el("span", "결재 대기"),
      );
      list.append(row);
    });
    host.append(list);
  }
  function renderNotifications() {
    const host = $("ybNotifications");
    host.replaceChildren();
    const unread = state.notifications.filter((item) => !item.readAt);
    const head = el("div", undefined, "yb-notification-head");
    head.append(
      el("strong", `문서 알림 ${unread.length}건`),
      el("span", "결재·지급·처리 결과는 계정별로 따로 읽음 처리됩니다."),
    );
    host.append(head);
    const labels = {
      approval_requested: "결재 요청",
      approval_withdrawn: "결재 회수",
      approval_rejected: "반려",
      approval_completed: "승인 완료",
      approval_cancelled: "승인 취소",
      payment_recorded: "지급 기록",
      settlement_completed: "정산 완료",
      processing_completed: "처리 완료",
    };
    unread.slice(0, 5).forEach((item) => {
      const row = button("", () =>
        run(async (epoch) => {
          await api({ action: "readNotification", id: item.id }, epoch);
          item.readAt = Date.now();
          renderNotifications();
          await detail(item.documentId, epoch);
        }),
      );
      row.className = "yb-notification-row";
      row.append(
        el("strong", labels[item.event] || "문서 알림"),
        el("span", `${item.number} · ${item.title}`),
      );
      host.append(row);
    });
    host.hidden = unread.length === 0;
  }
  function renderWorkspace() {
    applyRoleVisibility();
    setView(state.view);
    renderMetrics();
    renderNotifications();
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
        el("strong", d.details.title || "제목 없는 작성 중 문서"),
        el("span", d.number + " · " + kinds[d.kind]),
        el(
          "span",
          documentStatusLabel(d) +
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
  async function download(documentId, slot, file, epoch) {
    guard(epoch);
    const blob = await window.YJBusinessDocumentClient.downloadAttachment(
      documentId,
      slot,
      file,
    );
    guard(epoch);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message("첨부 다운로드와 SHA-256 무결성 검증을 완료했습니다.");
  }
  function csvCell(value) {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }
  function erpRecord(document) {
    return {
      voucherDate: document.details.transactionDate,
      documentNumber: document.number,
      taxType: document.details.taxType || "taxable",
      expenseCategory: document.details.category,
      payee: document.details.payee,
      supplyAmount: Number(document.details.supplyAmount) || 0,
      taxAmount: Number(document.details.taxAmount) || 0,
      totalAmount: Number(document.details.amount) || 0,
      summary: document.details.title,
      paymentMethod: document.details.paymentMethod,
      approvedAt: new Date(
        window.YJBusinessDocumentClient?.millis(document.approvedAt) || 0,
      ).toISOString(),
    };
  }
  function erpBlob(document, format) {
    const record = erpRecord(document);
    if (format === "json")
      return new Blob([JSON.stringify(record, null, 2)], {
        type: "application/json;charset=utf-8",
      });
    const headers = Object.keys(record);
    const csv =
      "\uFEFF" +
      headers.map(csvCell).join(",") +
      "\r\n" +
      headers.map((key) => csvCell(record[key])).join(",") +
      "\r\n";
    return new Blob([csv], { type: "text/csv;charset=utf-8" });
  }
  function downloadErpBlob(row, format, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${row.number}_DOUZONE.${format}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function uploadPaymentProof(documentId, paymentId, file, meta, epoch) {
    guard(epoch);
    await window.YJBusinessDocumentClient.uploadPaymentProof(
      documentId,
      paymentId,
      file,
      meta,
    );
    guard(epoch);
  }
  async function downloadPaymentProof(documentId, payment, epoch) {
    guard(epoch);
    const blob = await window.YJBusinessDocumentClient.downloadPaymentProof(
      documentId,
      payment.id,
      payment.proof,
    );
    guard(epoch);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = payment.proof.name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message("지급 증빙 다운로드와 SHA-256 무결성 검증을 완료했습니다.");
  }
  async function uploadDocumentAttachment(documentId, slot, file, meta, epoch) {
    guard(epoch);
    await window.YJBusinessDocumentClient.uploadAttachment(
      documentId,
      slot,
      file,
      meta,
    );
    guard(epoch);
  }
  async function detail(id, epoch) {
    const r = await api({ action: "detail", id }, epoch);
    state.selected = r;
    const d = r.document;
    const finance = isFinance();
    const box = $("ybDetail");
    box.replaceChildren();
    box.append(
      el("h4", d.details.title || "제목 없는 작성 중 문서"),
      el("p", d.number + " · " + documentStatusLabel(d)),
    );
    const dl = el("dl");
    pair(dl, "문서 종류", kinds[d.kind]);
    pair(dl, "작성자", d.requesterName);
    pair(dl, "사유", d.details.reason);
    for (const [key, label, t] of fields[d.kind]) {
      if (d.kind === "expense" && key === "settlementType" && !finance) continue;
      let val = d.details[key];
      if (key === "taxType" && !val) val = "taxable";
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
    if (d.kind === "expense" && finance) {
      pair(dl, "지급 상태", paymentLabels[d.paymentStatus]);
      pair(dl, "ERP 이관", d.erpExportStatus === "exported" ? "이관 완료" : d.status === "approved" ? "이관 대기" : "승인 전");
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
    if (d.cancellationReason) pair(dl, "승인 취소 사유", d.cancellationReason);
    box.append(dl);
    const documentAttachments = attachmentEntries(d);
    const completedAttachments = documentAttachments.filter(
      ([slot]) => d.attachmentCompletion?.[slot] === true,
    ).length;
    if (documentAttachments.length) {
      const panel = el("section", undefined, "yb-attachment-panel");
      panel.append(
        el("h5", "첨부 저장상태"),
        el(
          "p",
          completedAttachments === documentAttachments.length
            ? `저장·무결성 확인 완료 ${completedAttachments}/${documentAttachments.length}`
            : `재업로드 필요 ${documentAttachments.length - completedAttachments}개`,
          completedAttachments === documentAttachments.length
            ? "yb-attachment-summary is-complete"
            : "yb-attachment-summary is-warning",
        ),
      );
      for (const [slot, a] of documentAttachments) {
        const ready = d.attachmentCompletion?.[slot] === true;
        const row = el("div", undefined, "yb-attachment-item");
        const attachmentButton = button("다운로드: " + a.name, () =>
          run((e) => download(d.id, slot, a, e)),
        );
        attachmentButton.className = "yb-attachment";
        attachmentButton.disabled = !ready;
        attachmentButton.title = ready
          ? "다운로드 시 SHA-256 무결성을 검증합니다."
          : "업로드를 완료해야 다운로드할 수 있습니다.";
        const meta = el("span", `${formatBytes(a.size)} · ` + (ready ? "저장 완료" : "업로드 미완료"));
        meta.className = ready ? "is-complete" : "is-warning";
        row.append(attachmentButton, meta);
        panel.append(row);
      }
      box.append(panel);
    } else {
      box.append(el("p", "저장된 첨부가 없습니다.", "yb-attachment-empty"));
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
      actions.append(
        button("작성 중 문서 수정", () => {
          state.draft = null;
          state.revise = null;
          state.editing = d;
          type.disabled = false;
          type.value = d.kind;
          renderFields();
          type.disabled = true;
          $("yb-title").value = d.details.title;
          $("yb-reason").value = d.details.reason;
          for (const [k, v] of Object.entries(d.details)) {
            setFormValue(k, v);
          }
          calculateExpenseAmounts("total");
          if ($("yb-reviewerUid")) $("yb-reviewerUid").value = d.approverUids[0] || "";
          if ($("yb-approverUid"))
            $("yb-approverUid").value = d.approverUids[d.approverUids.length - 1] || "";
          $("ybFormTitle").textContent = "작성 중 문서 수정";
          $("ybClearFilesLabel").hidden = !d.attachmentCount;
          $("ybClearFiles").checked = false;
          renderFormAttachmentState(d);
          $("ybAttachmentHelp").textContent = d.attachmentCount
            ? "파일 선택란이 비어 있어도 저장 완료 표시가 있으면 기존 첨부는 유지됩니다. 새 파일을 선택하면 전체 교체합니다."
            : "현재 첨부가 없습니다. 지출결의서는 결재 요청 전에 증빙이 필요합니다.";
          setView("create");
          form.scrollIntoView({ behavior: "smooth" });
          message("작성 중 문서를 불러왔습니다. 수정 후 임시저장하거나 결재 요청하세요.");
        }),
      );
      for (const [slot, a] of Object.entries(d.attachments)) {
        if (d.attachmentCompletion?.[slot] === true) continue;
        const input = field(
          actions,
          "retry-" + slot,
          "미완료 첨부 재업로드: " + a.name,
          "file",
        );
        input.onchange = () =>
          run(async (e) => {
            const f = input.files[0];
            if (!f) return;
            await uploadDocumentAttachment(d.id, slot, f, a, e);
            await detail(d.id, e);
            message("첨부 업로드 완료 상태를 저장하고 확인했습니다.");
          });
      }
      const submit = button("결재 요청", () => run(() => act("submit")));
      const attachmentBlocked =
        completedAttachments !== documentAttachments.length ||
        (d.kind === "expense" && documentAttachments.length === 0);
      submit.disabled = attachmentBlocked;
      if (attachmentBlocked) {
        submit.title =
          d.kind === "expense" && documentAttachments.length === 0
            ? "지출결의서는 증빙 첨부를 저장한 후 결재 요청할 수 있습니다."
            : "모든 첨부의 저장 완료를 확인한 후 결재 요청할 수 있습니다.";
        actions.append(el("p", submit.title, "yb-action-warning"));
      }
      actions.append(submit);
    }
    if (d.status === "pending" && d.requesterUid === state.uid)
      actions.append(button("회수", () => run(() => act("withdraw"))));
    if (d.status === "pending" && d.approverUids[d.step] === state.uid) {
      if (d.kind === "expense" && d.step === 0 && finance) {
        const classification = field(
          actions,
          "accountingSettlementType",
          "회계 처리 유형",
          [
            "vendor:거래처 지급 요청",
            "reimbursement:직원 경비 정산",
            "prepaid:법인카드·기지급 정리",
          ],
          d.details.settlementType,
        );
        actions.append(
          button("회계 분류 저장", () =>
            run(async (currentEpoch) => {
              await api(
                operation({
                  action: "classifyExpense",
                  id,
                  settlementType: classification.value,
                  reason: classification.value,
                }),
                currentEpoch,
              );
              await load(currentEpoch);
              await detail(id, currentEpoch);
              message("회계 처리 유형을 저장했습니다.");
            }),
          ),
        );
      }
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
            setFormValue(k, v);
          }
          calculateExpenseAmounts("total");
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
          setFormValue("taxType", "taxable");
          $("yb-amount").value = d.details.amount;
          $("yb-supplyAmount").value = d.details.amount;
          $("yb-taxAmount").value = 0;
          calculateExpenseAmounts("total");
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
      !d.allocatedAmount &&
      d.erpExportStatus !== "exported"
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
    if (d.status === "approved" && d.kind === "expense" && finance) {
      const erpState = d.erpExportStatus || "ready";
      const erpPanel = el("section", undefined, "yb-erp-export");
      erpPanel.append(
        el("h4", "더존 ERP 내보내기"),
        el(
          "p",
          erpState === "exported"
            ? `이관 완료 · ${printDate(d.erpExportedAt)} · ${d.erpExportedBy || "처리자 확인"}`
            : "승인 데이터를 UTF-8 BOM CSV 또는 JSON으로 내려받고 이관 완료로 잠급니다.",
          "yb-help",
        ),
      );
      if (erpState !== "exported") {
        ["csv", "json"].forEach((format) =>
          erpPanel.append(
            button(`더존 ${format.toUpperCase()} 내보내기`, () =>
              run(async (currentEpoch) => {
                const blob = erpBlob(d, format);
                await api(
                  operation({ action: "exportErp", id, format }),
                  currentEpoch,
                );
                downloadErpBlob(d, format, blob);
                await load(currentEpoch);
                await detail(id, currentEpoch);
                message("ERP 파일을 생성하고 이관 완료 상태로 잠갔습니다.");
              }),
            ),
          ),
        );
      }
      actions.append(erpPanel);
    }
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
                  proof: await window.YJBusinessDocumentClient.describeFile(pending.file),
                }),
                e,
              );
              await uploadPaymentProof(
                id,
                pending.id,
                pending.file,
                prep.payment.proof,
                e,
              );
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
      if (p.proof && p.status === "recorded")
        box.append(
          button("지급 증빙 다운로드", () =>
            run((epoch) => downloadPaymentProof(id, p, epoch)),
          ),
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
                const m = await window.YJBusinessDocumentClient.describeFile(input.files[0]);
                if (
                  m.name !== p.proof.name ||
                  m.size !== p.proof.size ||
                  m.contentType !== p.proof.contentType
                )
                  throw new Error("등록한 증빙과 다른 파일입니다.");
                await uploadPaymentProof(id, p.id, input.files[0], p.proof, e);
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
      updateDraft: "임시저장 수정",
      submit: "결재 요청",
      classifyExpense: "회계 분류 저장",
      approve: "승인",
      reject: "반려",
      withdraw: "회수",
      preparePayment: "지급 증빙 준비",
      pay: "지급 기록",
      settle: "정산 완료",
      complete: "처리 완료",
      cancelApproved: "승인 취소",
      exportErp: "ERP 이관 완료",
    };
    for (const h of r.history)
      box.append(
        el(
          "p",
          new Date(window.YJBusinessDocumentClient?.millis(h.at) || h.at).toLocaleString("ko-KR") +
            " · " +
            h.actorName +
            " · " +
            (labels[h.action] || h.action) +
            (h.reason ? " · " + h.reason : ""),
        ),
      );
    if (r.capped)
      box.append(el("p", "이력은 최근 100건만 표시합니다.", "yb-error"));
    box.append(button("A4 표준서식 인쇄 / PDF", () => print(r)));
  }
  function printDate(value) {
    const millis = window.YJBusinessDocumentClient?.millis(value) || Number(value || 0);
    return millis ? new Date(millis).toLocaleString("ko-KR") : "-";
  }
  function printFieldValue(document, key, type) {
    let value = document.details[key];
    if (key === "taxType" && !value) value = "taxable";
    if (Array.isArray(type)) {
      const found = type.find((option) => option.split(":")[0] === value);
      value = found?.slice(found.indexOf(":") + 1) || value;
    }
    if (["amount", "supplyAmount", "taxAmount", "contractAmount"].includes(key))
      value = money(value);
    return value === undefined || value === null || value === "" ? "-" : String(value);
  }
  function printRow(table, label, value, className) {
    const row = el("tr", undefined, className);
    row.append(el("th", label), el("td", value || "-"));
    table.append(row);
  }
  function printWideRow(table, label, value, className) {
    const row = el("tr", undefined, className);
    const cell = el("td", value || "-");
    cell.colSpan = 3;
    row.append(el("th", label), cell);
    table.append(row);
  }
  function printPairRows(table, entries) {
    for (let index = 0; index < entries.length; index += 2) {
      const row = el("tr");
      const pairs = entries.slice(index, index + 2);
      pairs.forEach(([label, value]) => row.append(el("th", label), el("td", value || "-")));
      if (pairs.length === 1) row.lastElementChild.colSpan = 3;
      table.append(row);
    }
  }
  function approvalSignatures(r) {
    const document = r.document;
    const history = [...(r.history || [])].sort(
      (left, right) =>
        (window.YJBusinessDocumentClient?.millis(left.at) || 0) -
        (window.YJBusinessDocumentClient?.millis(right.at) || 0),
    );
    const submitted = history.find((item) => item.action === "submit");
    const signatures = [
      {
        role: "담당",
        name: document.requesterName || "-",
        state: document.status === "draft" ? "작성 중" : "전자제출",
        at: submitted?.at || document.submittedAt || document.createdAt,
        signed: document.status !== "draft",
      },
    ];
    const approverNames = Array.isArray(document.approverNames)
      ? document.approverNames
      : [];
    const approverUids = Array.isArray(document.approverUids)
      ? document.approverUids
      : [];
    const approvalRoles =
      document.kind === "expense" ? ["회계 검토", "최종 승인"] : ["최종 승인"];
    const approvalSlotCount = Math.max(approvalRoles.length, approverNames.length);
    Array.from({ length: approvalSlotCount }).forEach((_, index) => {
      const name = approverNames[index];
      const uid = approverUids[index];
      const approved = history.find(
        (item) => item.action === "approve" && item.actorUid === uid,
      );
      const rejected = [...history]
        .reverse()
        .find((item) => item.action === "reject" && item.actorUid === uid);
      signatures.push({
        role:
          approvalRoles[index] ||
          (index === approvalSlotCount - 1 ? "최종 승인" : "중간 검토"),
        name: name || "미지정",
        state: approved ? "전자승인" : rejected ? "반려" : "서명/도장",
        at: approved?.at || rejected?.at,
        signed: Boolean(approved),
        rejected: Boolean(rejected),
      });
    });
    return signatures;
  }
  function buildPrintDocument(r) {
    const document = r.document;
    const host = el("section", undefined, "yb-print");
    host.id = "ybPrint";

    const heading = el("header", undefined, "yb-print-heading");
    const brand = el("div", undefined, "yb-print-brand");
    brand.append(
      el("p", "용진기업 · YJ FLOW", "yb-print-company"),
      el("h1", kinds[document.kind] || "표준 결재문서"),
      el("p", `문서번호 ${document.number || "-"}`, "yb-print-number"),
    );
    const approvalTable = el("table", undefined, "yb-print-approval");
    approvalTable.setAttribute("aria-label", "결재 서명란");
    const signatures = approvalSignatures(r);
    const roleRow = el("tr");
    roleRow.append(el("th", "결재"));
    signatures.forEach((signature) => roleRow.append(el("th", signature.role)));
    const nameRow = el("tr");
    nameRow.append(el("th", "성명"));
    signatures.forEach((signature) => nameRow.append(el("td", signature.name)));
    const signRow = el("tr", undefined, "yb-print-sign-row");
    signRow.append(el("th", "서명/도장"));
    signatures.forEach((signature) => {
      const cell = el("td");
      const mark = el(
        "div",
        signature.state,
        "yb-signature-mark" +
          (signature.signed ? " is-approved" : "") +
          (signature.rejected ? " is-rejected" : ""),
      );
      cell.append(mark);
      signRow.append(cell);
    });
    const dateRow = el("tr");
    dateRow.append(el("th", "일시"));
    signatures.forEach((signature) => dateRow.append(el("td", printDate(signature.at))));
    approvalTable.append(roleRow, nameRow, signRow, dateRow);
    heading.append(brand, approvalTable);
    host.append(heading);

    const meta = el("table", undefined, "yb-print-table yb-print-compact-grid yb-print-meta-table");
    printPairRows(meta, [
      ["문서 상태", documentStatusLabel(document)],
      ["작성자", document.requesterName],
      ["작성일시", printDate(document.createdAt)],
      ["제출일시", printDate(document.submittedAt)],
      ["최종 승인", printDate(document.approvedAt)],
      ["문서번호", document.number || "-"],
    ]);
    host.append(el("h2", "문서 기본정보"), meta);

    const content = el("table", undefined, "yb-print-table yb-print-compact-grid yb-print-content-table");
    printWideRow(content, "제목", document.details.title || "제목 없는 문서", "yb-print-title-row");
    printWideRow(content, "요청 내용·사유", document.details.reason || "-", "yb-print-reason-row");
    const detailEntries = (fields[document.kind] || [])
      .map(([key, label, type]) => [label.replace(/ \(선택\)$/, ""), printFieldValue(document, key, type), key])
      .filter(([, value, key]) => value !== "-" || !["purchaseId", "orderReference"].includes(key))
      .map(([label, value]) => [label, value]);
    if (document.kind === "expense") {
      detailEntries.push(
        ["지급 상태", paymentLabels[document.paymentStatus] || "-"],
        ["지급액", money(document.paidAmount)],
        ["ERP 이관", document.erpExportStatus === "exported" ? "이관 완료" : "이관 전"],
      );
    }
    if (document.completedAt) detailEntries.push(["처리 결과", document.completionNote || "-"]);
    if (document.cancellationReason)
      detailEntries.push(["승인 취소 사유", document.cancellationReason]);
    printPairRows(content, detailEntries);
    host.append(el("h2", "결재 내용"), content);

    const attachments = attachmentEntries(document);
    const historyLabels = {
      create: "문서 작성",
      updateDraft: "임시저장 수정",
      submit: "결재 요청",
      approve: "승인",
      reject: "반려",
      withdraw: "회수",
      preparePayment: "지급 증빙 준비",
      pay: "지급 기록",
      settle: "정산 완료",
      complete: "처리 완료",
      cancelApproved: "승인 취소",
      classifyExpense: "회계 분류",
      exportErp: "ERP 이관",
    };
    const attachmentSummary = attachments.length
      ? attachments
          .map(
            ([slot, attachment]) =>
              `${attachment.name} (${formatBytes(attachment.size)}, ${
                document.attachmentCompletion?.[slot] === true ? "저장 확인" : "미완료"
              })`,
          )
          .join(" / ")
      : "첨부 없음";
    const historySummary = (r.history || []).length
      ? (r.history || [])
          .slice(-4)
          .map(
            (item) =>
              `${historyLabels[item.action] || item.action} · ${item.actorName || "-"} · ${printDate(item.at)}`,
          )
          .join(" / ")
      : "상단 결재 서명란 참조";
    const audit = el("table", undefined, "yb-print-table yb-print-compact-grid yb-print-audit");
    printWideRow(audit, "증빙·첨부", attachmentSummary);
    printWideRow(audit, "최근 처리이력", historySummary);
    host.append(el("h2", "증빙·결재 기록"), audit);

    const footer = el("footer", undefined, "yb-print-footer");
    footer.append(
      el("p", "본 문서는 YJ FLOW 전자결재 기록을 기준으로 출력되었습니다."),
      el("p", "서명 이미지가 등록되지 않은 계정은 성명과 전자결재 상태로 표시됩니다."),
      el("p", "출력일시 " + new Date().toLocaleString("ko-KR")),
    );
    host.append(footer);
    return host;
  }
  function print(r) {
    const host = buildPrintDocument(r);
    document.getElementById("ybPrint")?.remove();
    document.body.append(host);
    document.body.classList.add("yb-printing");
    const clean = () => {
      host.remove();
      document.body.classList.remove("yb-printing");
    };
    window.addEventListener("afterprint", clean, { once: true });
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        try {
          window.print();
        } catch (error) {
          clean();
          throw error;
        }
      }),
    );
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    run(async (epoch) => {
      if (!state.loaded)
        throw new Error("먼저 새로고침하여 결재자를 확인하세요.");
      const intent = event.submitter?.value === "draft" ? "draft" : "submit";
      if (!state.draft) {
        const input = Object.fromEntries(
          [...form.elements]
            .filter(
              (n) =>
                n.name &&
                n.name !== "intent" &&
                (n.type !== "radio" || n.checked),
            )
            .map((n) => [n.name, n.value]),
        );
        if (type.value === "expense" && !input.settlementType)
          input.settlementType =
            input.paymentMethod === "corporate_card"
              ? "prepaid"
              : state.editing?.details?.settlementType || "vendor";
        const details = { title: input.title, reason: input.reason };
        for (const [k, , t] of fields[type.value])
          details[k] = t === "number" ? Number(input[k]) : input[k] || "";
        const files = [...$("ybFiles").files];
        const fileDescriptions = await Promise.all(
          files.map((file) => window.YJBusinessDocumentClient.describeFile(file)),
        );
        if (
          fileDescriptions.reduce((sum, file) => sum + file.size, 0) >
          window.YJBusinessDocumentClient.limits.maxTotalSize
        )
          throw new Error("첨부 합계는 10MB 이하만 가능합니다.");
        const clearExisting = !!state.editing && $("ybClearFiles").checked;
        const replaceAttachments =
          !!state.editing && (files.length > 0 || clearExisting);
        const existingAttachments = attachmentEntries(state.editing);
        const effectiveAttachmentCount = files.length
          ? files.length
          : clearExisting
            ? 0
            : existingAttachments.length;
        const existingAttachmentsReady = existingAttachments.every(
          ([slot]) => state.editing?.attachmentCompletion?.[slot] === true,
        );
        if (
          intent === "submit" &&
          type.value === "expense" &&
          effectiveAttachmentCount === 0
        )
          throw new Error(
            "지출결의서는 증빙 첨부를 저장한 후 결재 요청하세요.",
          );
        if (
          intent === "submit" &&
          state.editing &&
          !replaceAttachments &&
          !existingAttachmentsReady
        )
          throw new Error(
            "미완료 첨부를 재업로드한 후 결재 요청하세요.",
          );
        state.draft = {
          id: state.editing?.id || uuid(),
          kind: type.value,
          details,
          reviewerUid: input.reviewerUid || "",
          approverUid: input.approverUid || "",
          files,
          fileDescriptions,
          revisedFrom: state.revise,
          editing: !!state.editing,
          replaceAttachments,
        };
      }
      const d = state.draft;
      message("문서를 저장하고 첨부를 올리는 중입니다…");
      const r = await api(
        operation({
          action: d.editing ? "updateDraft" : "create",
          id: d.id,
          kind: d.kind,
          details: d.details,
          reviewerUid: d.reviewerUid,
          approverUid: d.approverUid,
          files: d.fileDescriptions,
          revisedFrom: d.revisedFrom,
          replaceAttachments: d.replaceAttachments,
          draftOnly: intent === "draft",
        }),
        epoch,
      );
      d.persisted = true;
      for (let i = 0; i < d.files.length; i++)
        await uploadDocumentAttachment(
          d.id,
          "a" + i,
          d.files[i],
          r.document.attachments["a" + i],
          epoch,
        );
      if (intent === "submit") {
        try {
          await api(operation({ action: "submit", id: d.id }), epoch);
        } catch (error) {
          state.draft = null;
          state.editing = { id: d.id };
          type.disabled = true;
          $("ybFormTitle").textContent = "작성 중 문서 수정";
          throw error;
        }
      }
      state.draft = null;
      state.revise = null;
      state.editing = null;
      form.reset();
      type.disabled = false;
      renderFields();
      $("ybFormTitle").textContent = "새 문서 작성";
      $("ybClearFilesLabel").hidden = true;
      $("ybAttachmentHelp").textContent =
        "무료 요금제 전용 보안 저장 · 지출은 증빙 필수 · 구매·수리는 견적 첨부 권장";
      renderFormAttachmentState(null);
      try {
        await load(epoch);
        await detail(d.id, epoch);
        message(intent === "submit" ? "결재 요청이 완료됐습니다." : "임시저장했습니다.");
      } catch (e) {
        guard(epoch);
        message(
          (intent === "submit" ? "결재 요청" : "임시저장") +
            "은 완료됐지만 목록을 갱신하지 못했습니다. 새로고침하세요.",
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
  function openQualityException(order) {
    setView("create");
    state.draft = null;
    state.revise = null;
    state.editing = null;
    form.reset();
    renderFormAttachmentState(null);
    type.disabled = false;
    $("ybFormTitle").textContent = "새 문서 작성";
    $("ybClearFilesLabel").hidden = true;
    type.value = "quality";
    renderFields();
    $("yb-title").value = `생산·품질 예외 - ${order.client || order.orderNo || order.id}`;
    $("yb-reason").value = `${order.product || "품목"} 생산 과정에서 확인된 예외사항을 기록합니다.`;
    $("yb-orderReference").value = order.orderNo || order.id || "";
    $("yb-quantity").value = Number(order.quantity) || 0;
    root.scrollIntoView({ behavior: "smooth", block: "start" });
    message("연결 주문 정보를 불러왔습니다. 예외 내용과 처리안을 작성하세요.");
  }
  window.YJBusinessDocuments = {
    refresh: () => run(load),
    setView,
    openQualityException,
    getRows: () => state.rows.slice(),
  };
})();
