import assert from "node:assert/strict";
import test from "node:test";
import { assertCommunicationFileExtension, decodeVerifiedCommunicationUpload } from "./secure-upload.js";

test("communication attachments require a matching safe filename and signature", () => {
  const pdf = Buffer.from("%PDF-1.7\ncommunication").toString("base64");
  assert.doesNotThrow(() => {
    assertCommunicationFileExtension("notice.pdf", "application/pdf");
    assert.deepEqual(decodeVerifiedCommunicationUpload(pdf, "application/pdf"), Buffer.from("%PDF-1.7\ncommunication"));
  });
  assert.throws(() => assertCommunicationFileExtension("notice.exe", "application/pdf"), /extension/i);
  assert.throws(() => decodeVerifiedCommunicationUpload(Buffer.from("not a pdf").toString("base64"), "application/pdf"), /file type/i);
  assert.throws(() => decodeVerifiedCommunicationUpload("%%%", "application/pdf"), /base64/i);
});

test("communication attachment size is enforced after decoding", () => {
  const bytes = Buffer.alloc(1024 * 1024 + 1, 0);
  assert.throws(() => decodeVerifiedCommunicationUpload(Buffer.concat([Buffer.from("%PDF-"), bytes]).toString("base64"), "application/pdf", 1024), /size/i);
});
