import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const clientSource = readFileSync(
  new URL("../js/business-document-client.js", import.meta.url),
  "utf8",
);
const uiSource = readFileSync(
  new URL("../js/business-documents.js", import.meta.url),
  "utf8",
);
const htmlSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const snapshot = (value, id = "") => ({
  id,
  exists: value !== null,
  data: () => value,
});

function harness({ manifest = null, chunks = [] } = {}) {
  const user = { status: "active", name: "gene kim", role: "admin" };
  const db = {
    collection(name) {
      if (name === "users") {
        return { doc: () => ({ get: async () => snapshot(user, "gene") }) };
      }
      assert.equal(name, "business_documents");
      return {
        doc: () => ({
          collection(child) {
            if (child === "attachment_uploads") {
              return { doc: () => ({ get: async () => snapshot(manifest, "a0") }) };
            }
            assert.equal(child, "attachment_chunks");
            return {
              where: () => ({
                get: async () => ({ docs: chunks.map((row) => snapshot(row)) }),
              }),
            };
          },
        }),
      };
    },
  };
  const window = {
    auth: { currentUser: { uid: "gene" } },
    db,
    crypto: webcrypto,
    Blob,
  };
  vm.runInNewContext(clientSource, { window }, {
    filename: "js/business-document-client.js",
  });
  return window.YJBusinessDocumentClient;
}

const bytes = new Uint8Array([1, 2, 3, 4]);
const sha256 = Buffer.from(await webcrypto.subtle.digest("SHA-256", bytes))
  .toString("hex");
const expected = {
  name: "payment_test.pdf",
  size: bytes.byteLength,
  contentType: "application/pdf",
  chunkCount: 1,
  sha256,
  firestorePath: "business_documents/doc-1/attachment_uploads/a0",
};
const manifest = {
  ...expected,
  uploaderUid: "gene",
  completedAt: { seconds: 1 },
};
const validChunk = {
  slot: "a0",
  index: 0,
  size: bytes.byteLength,
  sha256,
  data: { toUint8Array: () => bytes },
};

test("WORK55 completed manifest is surfaced as saved attachment state", async () => {
  const client = harness({ manifest });
  const completion = await client.attachmentCompletion("doc-1", { a0: expected });
  assert.equal(completion.a0, true);
  assert.deepEqual(Object.keys(completion), ["a0"]);
});

test("WORK55 missing or mismatched manifest remains retryable", async () => {
  const missing = harness();
  const missingCompletion = await missing.attachmentCompletion("doc-1", { a0: expected });
  assert.equal(missingCompletion.a0, false);

  const mismatch = harness({ manifest: { ...manifest, sha256: "0".repeat(64) } });
  const mismatchedCompletion = await mismatch.attachmentCompletion("doc-1", { a0: expected });
  assert.equal(mismatchedCompletion.a0, false);
});

test("WORK55 download reconstructs the file only after SHA-256 verification", async () => {
  const client = harness({ manifest, chunks: [validChunk] });
  const blob = await client.downloadAttachment("doc-1", "a0", expected);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
  assert.equal(blob.type, "application/pdf");
});

test("WORK55 download rejects a chunk assigned to a different slot", async () => {
  const client = harness({
    manifest,
    chunks: [{ ...validChunk, slot: "a1" }],
  });
  await assert.rejects(
    client.downloadAttachment("doc-1", "a0", expected),
    /첨부 순서 또는 해시가 다릅니다/,
  );
});

test("WORK55 UI hides retry after persisted completion and reports verified download", () => {
  assert.match(uiSource, /if \(d\.attachmentCompletion\?\.\[slot\] === true\) continue/);
  assert.match(uiSource, /await detail\(d\.id, e\)/);
  assert.match(uiSource, /SHA-256 무결성 검증을 완료했습니다/);
  assert.match(htmlSource, /business-document-client\.js\?v=20261008-work57/);
  assert.match(htmlSource, /business-documents\.js\?v=20261009-work60-a4/);
});
