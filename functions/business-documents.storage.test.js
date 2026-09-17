"use strict";
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const req = createRequire(path.join(__dirname, "../tests/rules/package.json"));
const { initializeTestEnvironment, assertFails, assertSucceeds } = req(
  "@firebase/rules-unit-testing",
);
const { doc, setDoc, updateDoc } = req("firebase/firestore");
const { ref, uploadBytes, getMetadata, deleteObject } = req("firebase/storage");
let env;
const bytes = Uint8Array.from([1, 2, 3, 4, 5]);
const opts = { contentType: "application/pdf" };
async function seed(id, kind = "expense", status = "draft") {
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), "business_documents/" + id), {
      kind,
      status,
      requesterUid: "storage-employee",
      approverUids: ["storage-finance", "storage-admin"],
      attachments: {
        a0: {
          name: "proof.pdf",
          size: 5,
          contentType: "application/pdf",
          storagePath: "business-document-files/" + id + "/a0",
        },
      },
    });
  });
}
const storage = (uid) =>
  env
    .authenticatedContext(uid, { firebase: { sign_in_provider: "google.com" } })
    .storage("gs://demo-yj-documents.appspot.com");
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
    storage: {
      host: "127.0.0.1",
      port: 9295,
      rules: fs.readFileSync(path.join(__dirname, "../storage.rules"), "utf8"),
    },
  });
  await env.withSecurityRulesDisabled(async (c) => {
    for (const [id, role] of Object.entries({
      "storage-employee": "sales",
      "storage-finance": "accounting",
      "storage-admin": "admin",
      "storage-outsider": "sales",
      "storage-other-finance": "accounting",
    }))
      await setDoc(doc(c.firestore(), "users/" + id), {
        name: id,
        role,
        status: "active",
      });
  });
});
test.after(async () => {
  await env?.cleanup();
});
test("owner uploads registered evidence only; wrong bytes and another user denied", async () => {
  await seed("file-1");
  const anonymous = env
    .authenticatedContext("storage-employee", {
      firebase: { sign_in_provider: "anonymous" },
    })
    .storage("gs://demo-yj-documents.appspot.com");
  await assertFails(
    uploadBytes(
      ref(anonymous, "business-document-files/file-1/a0"),
      bytes,
      opts,
    ),
  );
  await assertFails(
    uploadBytes(
      ref(storage("storage-outsider"), "business-document-files/file-1/a0"),
      bytes,
      opts,
    ),
  );
  await assertFails(
    uploadBytes(
      ref(storage("storage-employee"), "business-document-files/file-1/a0"),
      new Uint8Array(6),
      opts,
    ),
  );
  await assertFails(
    uploadBytes(
      ref(storage("storage-employee"), "business-document-files/file-1/a1"),
      bytes,
      opts,
    ),
  );
  await assertSucceeds(
    uploadBytes(
      ref(storage("storage-employee"), "business-document-files/file-1/a0"),
      bytes,
      opts,
    ),
  );
  await assertFails(
    uploadBytes(
      ref(storage("storage-employee"), "business-document-files/file-1/a0"),
      bytes,
      opts,
    ),
  );
  await assertFails(
    deleteObject(
      ref(storage("storage-employee"), "business-document-files/file-1/a0"),
    ),
  );
});
test("reviewer can read financial evidence, unrelated employee cannot", async () => {
  await assertSucceeds(
    getMetadata(
      ref(storage("storage-finance"), "business-document-files/file-1/a0"),
    ),
  );
  await assertFails(
    getMetadata(
      ref(storage("storage-outsider"), "business-document-files/file-1/a0"),
    ),
  );
});
test("pending state locks uploads; leave attachments hidden from unrelated accounting", async () => {
  await seed("file-pending", "expense", "pending");
  await assertFails(
    uploadBytes(
      ref(
        storage("storage-employee"),
        "business-document-files/file-pending/a0",
      ),
      bytes,
      opts,
    ),
  );
  await seed("file-leave", "leave");
  await assertSucceeds(
    uploadBytes(
      ref(storage("storage-employee"), "business-document-files/file-leave/a0"),
      bytes,
      opts,
    ),
  );
  await assertFails(
    getMetadata(
      ref(
        storage("storage-other-finance"),
        "business-document-files/file-leave/a0",
      ),
    ),
  );
});
test("only registered payment actor uploads proof, completed proof immutable", async () => {
  await seed("payment-doc", "expense", "approved");
  await env.withSecurityRulesDisabled((c) =>
    setDoc(
      doc(c.firestore(), "business_documents/payment-doc/payments/payment-id"),
      {
        status: "draft",
        actorUid: "storage-finance",
        proof: { name: "proof.pdf", size: 5, contentType: "application/pdf" },
      },
    ),
  );
  const p = "business-payment-files/payment-doc/payment-id/proof";
  await assertFails(uploadBytes(ref(storage("storage-admin"), p), bytes, opts));
  await assertSucceeds(
    uploadBytes(ref(storage("storage-finance"), p), bytes, opts),
  );
  await env.withSecurityRulesDisabled((c) =>
    updateDoc(
      doc(c.firestore(), "business_documents/payment-doc/payments/payment-id"),
      { status: "recorded" },
    ),
  );
  await assertFails(
    uploadBytes(ref(storage("storage-finance"), p), bytes, opts),
  );
  await assertFails(deleteObject(ref(storage("storage-finance"), p)));
  await assertSucceeds(getMetadata(ref(storage("storage-employee"), p)));
});
