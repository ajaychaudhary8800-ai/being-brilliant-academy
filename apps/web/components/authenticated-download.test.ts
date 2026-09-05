import assert from "node:assert/strict";
import test from "node:test";
import { canPreviewDocument, readAuthenticatedDocumentResponse } from "./authenticated-download";

test("a JSON API error is rejected before any Blob is created", async () => {
  let blobCalled = false;
  const response = {
    ok: false,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => ({ error: { message: "Question paper is not available yet" } }),
    blob: async () => { blobCalled = true; return new Blob(["error"]); },
  };
  await assert.rejects(() => readAuthenticatedDocumentResponse(response, "paper.pdf", "Paper unavailable"), /not available yet/);
  assert.equal(blobCalled, false);
});

test("a successful authenticated binary response preserves MIME type and safe filename", async () => {
  const response = new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), {
    status: 200,
    headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline; filename=\"question-paper.pdf\"" },
  });
  const result = await readAuthenticatedDocumentResponse(response, "fallback.pdf", "Paper unavailable");
  assert.equal(result.contentType, "application/pdf");
  assert.equal(result.fileName, "question-paper.pdf");
  assert.equal(await result.blob.text(), "%PDF-");
  assert.equal(canPreviewDocument(result.contentType), true);
  assert.equal(canPreviewDocument("application/vnd.openxmlformats-officedocument.wordprocessingml.document"), false);
});
