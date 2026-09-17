"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const req = createRequire(path.join(__dirname, "../tests/rules/package.json"));
const { initializeTestEnvironment, assertFails, assertSucceeds } = req(
  "@firebase/rules-unit-testing",
);
const { doc, setDoc, getDoc } = req("firebase/firestore");
let env;
test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-yj-documents",
    firestore: {
      host: "127.0.0.1",
      port: 8185,
      rules: fs.readFileSync(
        path.join(__dirname, "../firestore.rules"),
        "utf8",
      ),
    },
  });
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, "users/rules-admin"), {
      role: "admin",
      name: "대표",
      status: "active",
    });
    await setDoc(doc(db, "users/rules-employee"), {
      role: "sales",
      name: "직원",
      status: "active",
    });
    await setDoc(doc(db, "business_documents/rules-document"), {
      requesterUid: "rules-employee",
      status: "approved",
    });
  });
});
test.after(async () => {
  await env?.cleanup();
});
test("client SDK cannot forge standardized document, history, payment or numbering even as admin", async () => {
  for (const uid of ["rules-admin", "rules-employee"]) {
    const db = env
      .authenticatedContext(uid, {
        firebase: { sign_in_provider: "google.com" },
      })
      .firestore();
    for (const p of [
      "business_documents/rules-document",
      "business_documents/rules-document/history/event",
      "business_documents/rules-document/payments/payment",
      "business_document_sequences/2026",
      "business_payment_references/reference",
    ])
      await assertFails(setDoc(doc(db, p), { status: "paid", amount: 1 }));
  }
});
test("standard document reads must pass callable authorization, anonymous denied", async () => {
  for (const ctx of [
    env.authenticatedContext("rules-admin"),
    env.authenticatedContext("rules-employee"),
    env.unauthenticatedContext(),
  ])
    await assertFails(
      getDoc(doc(ctx.firestore(), "business_documents/rules-document")),
    );
});
