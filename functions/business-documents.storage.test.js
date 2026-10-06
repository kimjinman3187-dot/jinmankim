"use strict";

const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const req = createRequire(path.join(__dirname, "../tests/rules/package.json"));
const { initializeTestEnvironment, assertFails, assertSucceeds } = req(
  "@firebase/rules-unit-testing",
);
const {
  Bytes,
  doc,
  getDoc,
  deleteDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} = req("firebase/firestore");

let env;
const projectId = "demo-yj-documents";
const documentId = "firestore-file-1";
const sha256 = "a".repeat(64);
const totalSize = 700000;
const secondSize = totalSize - 524288;
const token = { firebase: { sign_in_provider: "google.com" } };

const db = (uid) => env.authenticatedContext(uid, token).firestore();
const chunk = (slot, index, size, hash = sha256) => ({
  slot,
  index,
  size,
  sha256: hash,
  data: Bytes.fromUint8Array(new Uint8Array(size)),
  uploaderUid: "file-employee",
  uploadedAt: serverTimestamp(),
});
const manifest = () => ({
  name: "evidence.pdf",
  size: totalSize,
  contentType: "application/pdf",
  chunkCount: 2,
  sha256,
  firestorePath:
    "business_documents/" + documentId + "/attachment_uploads/a0",
  uploaderUid: "file-employee",
  completedAt: serverTimestamp(),
});

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: fs.readFileSync(path.join(__dirname, "../firestore.rules"), "utf8"),
    },
  });
  await env.withSecurityRulesDisabled(async (context) => {
    for (const [uid, role] of Object.entries({
      "file-employee": "sales",
      "file-admin": "admin",
      "file-outsider": "sales",
    })) {
      await setDoc(doc(context.firestore(), "users/" + uid), {
        name: uid,
        role,
        status: "active",
      });
    }
    await setDoc(doc(context.firestore(), "business_documents/" + documentId), {
      schemaVersion: 7,
      clientMode: "spark-firestore",
      kind: "general",
      status: "draft",
      requesterUid: "file-employee",
      approverUids: ["file-admin"],
      attachments: {
        a0: {
          name: "evidence.pdf",
          size: totalSize,
          contentType: "application/pdf",
          chunkCount: 2,
          sha256,
          firestorePath:
            "business_documents/" + documentId + "/attachment_uploads/a0",
        },
      },
    });
  });
});

test.after(async () => {
  await env?.cleanup();
});

test("요청자만 정확한 ID·크기·해시의 Firestore 청크를 생성한다", async () => {
  const employee = db("file-employee");
  await assertFails(
    setDoc(
      doc(employee, `business_documents/${documentId}/attachment_chunks/a0-0`),
      chunk("a0", 0, 100),
    ),
  );
  await assertFails(
    setDoc(
      doc(employee, `business_documents/${documentId}/attachment_chunks/wrong-id`),
      chunk("a0", 0, 524288),
    ),
  );
  await assertFails(
    setDoc(
      doc(db("file-outsider"), `business_documents/${documentId}/attachment_chunks/a0-0`),
      chunk("a0", 0, 524288),
    ),
  );
  await assertSucceeds(
    setDoc(
      doc(employee, `business_documents/${documentId}/attachment_chunks/a0-0`),
      chunk("a0", 0, 524288),
    ),
  );
  await assertFails(
    updateDoc(
      doc(employee, `business_documents/${documentId}/attachment_chunks/a0-0`),
      { sha256: "b".repeat(64) },
    ),
  );
});

test("모든 청크가 있어야 불변 완료 매니페스트를 생성한다", async () => {
  const employee = db("file-employee");
  const manifestRef = doc(
    employee,
    `business_documents/${documentId}/attachment_uploads/a0`,
  );
  await assertFails(setDoc(manifestRef, manifest()));
  await assertFails(
    setDoc(
      doc(employee, `business_documents/${documentId}/attachment_chunks/a0-1`),
      chunk("a0", 1, secondSize, "b".repeat(64)),
    ),
  );
  await assertSucceeds(
    setDoc(
      doc(employee, `business_documents/${documentId}/attachment_chunks/a0-1`),
      chunk("a0", 1, secondSize),
    ),
  );
  await assertSucceeds(setDoc(manifestRef, manifest()));
  await assertFails(updateDoc(manifestRef, { size: 1 }));
});

test("요청자·결재자는 첨부를 읽고 무관 사용자는 읽지 못한다", async () => {
  const pathName = `business_documents/${documentId}/attachment_chunks/a0-0`;
  await assertSucceeds(getDoc(doc(db("file-employee"), pathName)));
  await assertSucceeds(getDoc(doc(db("file-admin"), pathName)));
  await assertFails(getDoc(doc(db("file-outsider"), pathName)));
});

test("작성 중 요청자는 첨부를 교체할 수 있고 무관 사용자는 삭제할 수 없다", async () => {
  const chunkPath = `business_documents/${documentId}/attachment_chunks/a0-0`;
  const manifestPath = `business_documents/${documentId}/attachment_uploads/a0`;
  await assertFails(deleteDoc(doc(db("file-outsider"), chunkPath)));
  await assertFails(deleteDoc(doc(db("file-outsider"), manifestPath)));
  await assertSucceeds(deleteDoc(doc(db("file-employee"), manifestPath)));
  await assertSucceeds(deleteDoc(doc(db("file-employee"), chunkPath)));
});

test("제출 이후에는 새 청크와 매니페스트를 만들 수 없다", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), "business_documents/" + documentId), {
      status: "pending",
    });
  });
  await assertFails(
    setDoc(
      doc(
        db("file-employee"),
        `business_documents/${documentId}/attachment_chunks/a0-2`,
      ),
      chunk("a0", 2, 1),
    ),
  );
});
