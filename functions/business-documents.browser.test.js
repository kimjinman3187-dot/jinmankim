"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require("playwright");
let browser, page;
const requests = [];
let listDocuments = [];
let directoryUsers = [];
let detailDocument = null;
const users = [
  { uid: "finance", name: "회계 직원", role: "accounting" },
  { uid: "admin", name: "최종 승인자", role: "admin" },
];
let slowResolve;
async function mount() {
  directoryUsers = users;
  detailDocument = null;
  await page.route("https://yj.test/", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<html lang="ko"><body><main style="padding:20px;background:#0f172a"><span id="pcHubDocGlanceTotal"></span><span id="pcHubDocGlancePending"></span><span id="pcHubDocGlanceRejected"></span><span id="pcHubDocGlancePayment"></span><p id="pcHubDocGlanceState"></p><section id="yjUnifiedApprovalInbox"></section><section id="yjBusinessDocuments"></section></main></body></html>',
    }),
  );
  await page.goto("https://yj.test/");
  await page.addStyleTag({
    content: fs.readFileSync(
      path.join(__dirname, "../business-documents.css"),
      "utf8",
    ),
  });
  await page.evaluate(() => {
    window.auth = { currentUser: { uid: "employee" } };
    window.testUser = {
      uid: "employee",
      name: "시험 직원",
      role: "sales",
      status: "active",
    };
    window.yjGetCurrentUser = () => window.testUser;
    window.YJBusinessDocumentClient = {
      request: (data) => window.backend(data),
      millis: (value) => Number(value) || Date.now(),
      describeFile: async (file) => ({
        name: file.name,
        size: file.size,
        contentType: file.type,
        chunkCount: 1,
        sha256: "a".repeat(64),
      }),
      uploadAttachment: async () => ({ ok: true }),
      downloadAttachment: async () => new Blob(["test"]),
      limits: { maxTotalSize: 10 * 1024 * 1024 },
    };
  });
  await page.addScriptTag({
    content: fs.readFileSync(
      path.join(__dirname, "../js/business-documents.js"),
      "utf8",
    ),
  });
}
test.before(async () => {
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.YJ_BROWSER_PATH ||
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => console.error("[browser-pageerror]", error));
  await page.exposeFunction("backend", async (data) => {
    requests.push(data);
    if (data.action === "directory") return { users: directoryUsers };
    if (data.action === "list") return { documents: listDocuments, capped: false };
    if (data.action === "notifications") return { notifications: [], capped: false };
    if (["create", "updateDraft"].includes(data.action))
      return { document: { attachments: {} } };
    if (data.action === "submit") return { ok: true };
    if (data.action === "detail") {
      if (detailDocument)
        return { document: detailDocument, history: [], payments: [], capped: false };
      throw new Error("simulated refresh failure");
    }
    return {};
  });
});
test.after(async () => {
  await browser?.close();
});
test("all five forms render; form values survive disabled fieldset during submission", async () => {
  listDocuments = [];
  await mount();
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await page.getByText("표준 문서 0건을 확인했습니다.").waitFor();
  for (const kind of ["expense", "purchase", "leave", "general", "quality"]) {
    await page.locator("#yb-kind").selectOption(kind);
    assert.ok(
      (await page
        .locator("#ybFields input,#ybFields select,#ybFields textarea")
        .count()) > 0,
    );
  }
  await page.locator("#yb-kind").selectOption("purchase");
  await page.locator("#yb-title").fill("자재 구매 요청");
  await page.locator("#yb-reason").fill("제조에 필요한 자재");
  await page.locator("#yb-item").fill("철판");
  await page.locator("#yb-quantity").fill("3");
  await page.locator("#yb-amount").fill("11000");
  await page.locator("#yb-neededDate").fill("2026-09-20");
  await page.locator("#yb-approverUid").selectOption("admin");
  await page
    .getByRole("button", { name: "저장하고 결재 요청", exact: true })
    .click();
  await page
    .getByText(
      "결재 요청은 완료됐지만 목록을 갱신하지 못했습니다. 새로고침하세요.",
    )
    .waitFor();
  const create = requests.findLast((x) => x.action === "create");
  assert.equal(create.details.title, "자재 구매 요청");
  assert.equal(create.details.amount, 11000);
  assert.equal(create.approverUid, "admin");
  assert.equal(requests.filter((x) => x.action === "submit").length, 1);
});
test("expense form keeps requester DOM simple and calculates tax both ways", async () => {
  listDocuments = [];
  await mount();
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await page.getByText("표준 문서 0건을 확인했습니다.").waitFor();
  await page.locator("#yb-kind").selectOption("expense");
  assert.equal(await page.locator("#yb-settlementType").count(), 0);
  assert.equal(await page.locator(".yb-related").getAttribute("open"), null);
  await page.locator("#yb-amount").fill("11000");
  assert.equal(await page.locator("#yb-supplyAmount").inputValue(), "10000");
  assert.equal(await page.locator("#yb-taxAmount").inputValue(), "1000");
  await page.locator('[name="taxType"][value="exempt"]').check();
  assert.equal(await page.locator("#yb-supplyAmount").inputValue(), "11000");
  assert.equal(await page.locator("#yb-taxAmount").inputValue(), "0");
  assert.equal(await page.locator("#yb-taxAmount").isDisabled(), true);
  await page.locator("#yb-supplyAmount").fill("22000");
  assert.equal(await page.locator("#yb-amount").inputValue(), "22000");
});
test("accounting can see classification and export one approved expense file", async () => {
  const approvedExpense = {
    id: "erp-ready-1",
    number: "YJ-EXPENSE-20261009-ERP001",
    kind: "expense",
    status: "approved",
    erpExportStatus: "ready",
    requesterUid: "employee",
    requesterName: "시험 직원",
    approverUids: ["finance", "admin"],
    approverNames: ["회계 직원", "최종 승인자"],
    step: 1,
    attachments: {},
    paidAmount: 0,
    paymentStatus: "unpaid",
    approvedAt: Date.now(),
    details: {
      title: "ERP 이관 검증",
      reason: "더존 CSV 생성",
      settlementType: "vendor",
      category: "material",
      taxType: "taxable",
      supplyAmount: 10000,
      taxAmount: 1000,
      amount: 11000,
      payee: "검증 거래처",
      transactionDate: "2026-10-09",
      plannedDate: "2026-10-10",
      paymentMethod: "bank_transfer",
      purchaseId: "",
      orderReference: "",
    },
  };
  listDocuments = [approvedExpense];
  await mount();
  detailDocument = approvedExpense;
  await page.evaluate(() => {
    window.auth.currentUser = { uid: "finance" };
    window.testUser = {
      uid: "finance",
      name: "회계 직원",
      role: "accounting",
      status: "active",
    };
  });
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await page.getByText("표준 문서 1건을 확인했습니다.").waitFor();
  assert.equal(await page.locator("#yb-settlementType").count(), 1);
  await page.getByRole("button", { name: "전체 문서", exact: true }).click();
  await page.locator("#ybList .yb-row").first().click();
  const exportButton = page.getByRole("button", { name: "더존 CSV 내보내기", exact: true });
  const [download] = await Promise.all([page.waitForEvent("download"), exportButton.click()]);
  assert.equal(download.suggestedFilename(), "YJ-EXPENSE-20261009-ERP001_DOUZONE.csv");
  const request = requests.findLast((item) => item.action === "exportErp");
  assert.equal(request.format, "csv");
});
test("partial forms can be saved as drafts and existing drafts can be edited", async () => {
  listDocuments = [];
  await mount();
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await page.getByText("표준 문서 0건을 확인했습니다.").waitFor();
  await page.locator("#yb-kind").selectOption("general");
  await page.locator("#yb-title").fill("작성 중 품의");
  await page.getByRole("button", { name: "임시저장", exact: true }).click();
  await page.getByText(/임시저장은 완료됐지만/).waitFor();
  const created = requests.findLast((item) => item.action === "create");
  assert.equal(created.draftOnly, true);
  assert.equal(created.details.reason, "");

  const draft = {
    id: "draft-edit-1",
    number: "YJ-GENERAL-20261006-DRAFT1",
    kind: "general",
    status: "draft",
    requesterUid: "employee",
    requesterName: "시험 직원",
    approverUids: ["admin"],
    approverNames: ["최종 승인자"],
    attachmentCount: 0,
    attachments: {},
    step: 0,
    details: { title: "수정 전", reason: "기존 내용", effectiveDate: "", amount: 0 },
  };
  listDocuments = [draft];
  detailDocument = draft;
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await page.locator("#ybList .yb-row").first().click();
  await page.getByRole("button", { name: "작성 중 문서 수정", exact: true }).click();
  await page.locator("#yb-title").fill("수정 후");
  await page.getByRole("button", { name: "임시저장", exact: true }).click();
  const updated = requests.findLast((item) => item.action === "updateDraft");
  assert.equal(updated.id, "draft-edit-1");
  assert.equal(updated.details.title, "수정 후");
  assert.equal(updated.draftOnly, true);
});

test("approved document actions call cancelApproved and complete backends", async () => {
  const approved = {
    id: "approved-actions",
    number: "YJ-GENERAL-20261006-DONE01",
    kind: "general",
    status: "approved",
    requesterUid: "other",
    requesterName: "다른 직원",
    approverUids: ["employee"],
    approverNames: ["시험 관리자"],
    attachments: {},
    step: 0,
    paidAmount: 0,
    allocatedAmount: 0,
    settledAt: null,
    completedAt: null,
    details: { title: "승인 완료 문서", reason: "후속 처리 검증", effectiveDate: "2026-10-06", amount: 0 },
  };
  listDocuments = [approved];
  await mount();
  await page.evaluate(() => {
    window.testUser.role = "admin";
  });
  detailDocument = approved;
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await page.getByRole("button", { name: "전체 문서", exact: true }).click();
  await page.locator("#ybList .yb-row").first().click();
  await page.locator("#yb-cancelReason").fill("조건 변경");
  await page.getByRole("button", { name: "승인 취소", exact: true }).click();
  assert.equal(requests.findLast((item) => item.action === "cancelApproved").reason, "조건 변경");
  await page.locator("#yb-completionNote").fill("업무 반영 완료");
  await page.getByRole("button", { name: "처리 완료 기록", exact: true }).click();
  assert.equal(requests.findLast((item) => item.action === "complete").reason, "업무 반영 완료");
});
test("unified workspace separates my documents, approval inbox and dashboard metrics", async () => {
  listDocuments = [
    {
      id: "mine",
      number: "YJ-GEN-1",
      kind: "general",
      status: "rejected",
      requesterUid: "employee",
      requesterName: "시험 직원",
      approverUids: ["admin"],
      step: 0,
      details: { title: "내 반려 문서" },
    },
    {
      id: "inbox",
      number: "YJ-GEN-2",
      kind: "general",
      status: "pending",
      requesterUid: "other",
      requesterName: "다른 직원",
      approverUids: ["employee"],
      step: 0,
      details: { title: "내 결재 대상" },
    },
    {
      id: "payment",
      number: "YJ-EXP-3",
      kind: "expense",
      status: "approved",
      paymentStatus: "partial",
      requesterUid: "other",
      requesterName: "다른 직원",
      approverUids: ["admin"],
      step: 0,
      details: { title: "일부 지급 문서" },
    },
  ];
  await mount();
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await page.getByText("표준 문서 3건을 확인했습니다.").waitFor();
  assert.equal(await page.locator("#ybMetricMine").innerText(), "1");
  assert.equal(await page.locator("#ybMetricPending").innerText(), "1");
  assert.equal(await page.locator("#ybMetricRejected").innerText(), "1");
  assert.equal(await page.locator("#pcHubDocGlancePending").innerText(), "1");
  assert.match(await page.locator("#yjUnifiedApprovalInbox").innerText(), /내 결재 대상/);
  await page.getByRole("button", { name: "내 문서", exact: true }).click();
  assert.match(await page.locator("#ybList").innerText(), /내 반려 문서/);
  assert.doesNotMatch(await page.locator("#ybList").innerText(), /내 결재 대상/);
  await page.getByRole("button", { name: "결재함", exact: true }).click();
  assert.match(await page.locator("#ybList").innerText(), /내 결재 대상/);
  assert.equal(await page.locator("#ybForm").isVisible(), false);
});
test("legacy document areas are marked as collapsed read-only archives", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.match(html, /이전 문서 보관함/);
  assert.match(html, /이전 결재 기록/);
  assert.equal((html.match(/data-yj-legacy-readonly="true"/g) || []).length, 2);
});
test("Spark-only attachment UI has explicit limits and no Cloud Storage calls", () => {
  const ui = fs.readFileSync(
    path.join(__dirname, "../js/business-documents.js"),
    "utf8",
  );
  const client = fs.readFileSync(
    path.join(__dirname, "../js/business-document-client.js"),
    "utf8",
  );
  assert.match(ui, /각 3MB·합계 10MB/);
  assert.match(client, /attachment_chunks/);
  assert.doesNotMatch(ui + client, /firebase\.storage\s*\(/);
});
test("missing approver setup is explained and prevents unsafe document submission", async () => {
  listDocuments = [];
  await mount();
  directoryUsers = [];
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await page
    .getByText(/결재자 명단이 아직 준비되지 않았습니다/)
    .waitFor();
  await page.waitForFunction(() => document.getElementById("ybFieldset").disabled);
  assert.equal(await page.locator("#ybFieldset").evaluate((node) => node.disabled), true);
  assert.equal(await page.locator("#ybMetricMine").innerText(), "0");
});
test("load failure shows an honest unknown state instead of zero counts or raw internal", async () => {
  await mount();
  await page.evaluate(() => {
    window.YJBusinessDocumentClient.request = async () => {
      throw new Error("internal");
    };
  });
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await page.getByText(/문서를 불러오지 못했습니다/).waitFor();
  assert.equal(await page.locator("#ybMetricMine").innerText(), "—");
  assert.equal(await page.locator("#pcHubDocGlanceTotal").innerText(), "조회 실패");
  assert.doesNotMatch(await page.locator("#yjBusinessDocuments").innerText(), /\binternal\b/);
});
test("A4 print view keeps a standard expense approval form on one page", async () => {
  const document = {
    id: "printable",
    number: "YJ-EXPENSE-20260930-ABC123",
    kind: "expense",
    status: "approved",
    requesterUid: "employee",
    requesterName: "시험 직원",
    approverUids: ["accounting", "admin"],
    approverNames: ["회계 담당자", "최종 승인자"],
    step: 2,
    paymentStatus: "unpaid",
    paidAmount: 0,
    erpExportStatus: "ready",
    attachments: {
      slot1: { name: "거래명세서.pdf", size: 182400, type: "application/pdf" },
    },
    attachmentCompletion: { slot1: true },
    details: {
      title: "10월 원자재 매입대금 지급",
      reason: "승인된 원자재 구매 건에 대한 거래처 지급 요청이며 세금계산서와 거래명세서를 확인했습니다.",
      settlementType: "vendor",
      category: "material",
      taxType: "taxable",
      amount: 121000,
      supplyAmount: 110000,
      taxAmount: 11000,
      payee: "테스트 거래처",
      transactionDate: "2026-10-08",
      plannedDate: "2026-10-15",
      paymentMethod: "bank_transfer",
      purchaseId: "PURCHASE-20261008-01",
      orderReference: "ORDER-20261008-01",
    },
  };
  listDocuments = [document];
  await mount();
  detailDocument = document;
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await page.getByText("표준 문서 1건을 확인했습니다.").waitFor();
  await page.locator("#ybList .yb-row").first().click();
  await page.locator("#ybDetail h4").first().waitFor();
  const printButton = page.locator("#ybDetail button").filter({ hasText: "A4 표준서식 인쇄 / PDF" });
  await printButton.waitFor();
  await page.evaluate(() => {
    window.print = () => {};
  });
  await printButton.click();
  assert.equal(await page.locator("#ybPrint").count(), 1);
  assert.equal(await page.locator("#ybPrint button,#ybPrint input,#ybPrint select").count(), 0);
  await page.emulateMedia({ media: "print" });
  const printHeight = await page.locator("#ybPrint").evaluate((node) => node.getBoundingClientRect().height);
  assert.ok(printHeight <= (277 / 25.4) * 96, `표준 지출결의서가 A4 인쇄 높이를 초과했습니다: ${printHeight}px`);
  const pdfPath = path.join(os.tmpdir(), "yj-work53-document-a4.pdf");
  await page.pdf({ path: pdfPath, format: "A4", printBackground: true });
  const pdf = fs.readFileSync(pdfPath);
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  assert.equal((pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length, 1);
});
test("account switch clears sensitive form values and invalidates old session", async () => {
  listDocuments = [];
  await mount();
  await page.locator("#yb-title").fill("비공개 비용");
  await page.evaluate(() => {
    window.auth.currentUser = { uid: "other" };
    window.testUser = {
      uid: "other",
      name: "다른 사용자",
      role: "sales",
      status: "active",
    };
  });
  await page.waitForFunction(
    () => document.getElementById("yb-title").value === "",
  );
  assert.equal(await page.locator("#ybDetail").innerText(), "");
});
test("no horizontal overflow at 360,390,430,1440; labels and focus exist", async () => {
  for (const width of [360, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  }
  await page.locator("#yb-title").focus();
  assert.equal(
    await page
      .locator("#yb-title")
      .evaluate((n) => getComputedStyle(n).outlineStyle),
    "solid",
  );
  await page.screenshot({
    path: path.join(os.tmpdir(), "yj-work46-documents-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.screenshot({
    path: path.join(os.tmpdir(), "yj-work46-documents-mobile.png"),
    fullPage: true,
  });
});
test("actual Spark client hashes files and enforces the 3MiB chunk limit", async () => {
  await page.addScriptTag({
    content: fs.readFileSync(
      path.join(__dirname, "../js/business-document-client.js"),
      "utf8",
    ),
  });
  const result = await page.evaluate(async () => {
    const file = new File([new Uint8Array(600000)], "proof.pdf", {
      type: "application/pdf",
    });
    const metadata = await window.YJBusinessDocumentClient.describeFile(file);
    let oversizedMessage = "";
    try {
      await window.YJBusinessDocumentClient.describeFile(
        new File([new Uint8Array(3 * 1024 * 1024 + 1)], "large.pdf", {
          type: "application/pdf",
        }),
      );
    } catch (error) {
      oversizedMessage = error.message;
    }
    return { metadata, oversizedMessage };
  });
  assert.equal(result.metadata.chunkCount, 2);
  assert.equal(result.metadata.sha256.length, 64);
  assert.match(result.oversizedMessage, /3MB 이하/);
});
