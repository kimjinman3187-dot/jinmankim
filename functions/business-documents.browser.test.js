"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require("playwright");
let browser, page;
const requests = [];
const users = [
  { uid: "finance", name: "회계 직원", role: "accounting" },
  { uid: "admin", name: "최종 승인자", role: "admin" },
];
let slowResolve;
async function mount() {
  await page.route("https://yj.test/", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<html lang="ko"><body><main style="padding:20px;background:#0f172a"><section id="yjBusinessDocuments"></section></main></body></html>',
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
    window.firebase = {
      app: () => ({
        functions: () => ({
          httpsCallable: () => async (data) => ({
            data: await window.backend(data),
          }),
        }),
      }),
      storage: () => ({
        ref: () => ({
          getMetadata: async () => {
            throw Object.assign(new Error("missing"), {
              code: "storage/object-not-found",
            });
          },
          put: async () => {},
        }),
      }),
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
  await page.exposeFunction("backend", async (data) => {
    requests.push(data);
    if (data.action === "directory") return { users };
    if (data.action === "list") return { documents: [], capped: false };
    if (data.action === "create") return { document: { attachments: {} } };
    if (data.action === "submit") return { ok: true };
    if (data.action === "detail") throw new Error("simulated refresh failure");
    return {};
  });
});
test.after(async () => {
  await browser?.close();
});
test("all five forms render; form values survive disabled fieldset during submission", async () => {
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
test("account switch clears sensitive form values and invalidates old session", async () => {
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
