import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAIExaminerEvidenceKindMatchesMime,
  decodeAIExaminerEvidenceUpload,
  normalizeAIExaminerEvidenceUrl,
} from "./ai-examiner-evidence-upload.js";

test("supplementary evidence upload validates PDF bytes and hashes content", () => {
  const bytes = Buffer.from("%PDF-1.4\nmock evidence", "ascii");
  const result = decodeAIExaminerEvidenceUpload({
    base64: bytes.toString("base64"),
    fileName: "viva-evidence.pdf",
    mimeType: "application/pdf",
  });
  assert.equal(result.bytes.equals(bytes), true);
  assert.match(result.contentSha256, /^[a-f0-9]{64}$/);
});

test("supplementary evidence rejects extension and MIME mismatches", () => {
  const bytes = Buffer.from("%PDF-1.4\nmock", "ascii");
  assert.throws(() => decodeAIExaminerEvidenceUpload({
    base64: bytes.toString("base64"),
    fileName: "clip.mp4",
    mimeType: "application/pdf",
  }));
  assert.throws(() => assertAIExaminerEvidenceKindMatchesMime("AUDIO", "video/mp4"));
  assert.throws(() => assertAIExaminerEvidenceKindMatchesMime("DOCUMENT", "image/png"));
});

test("supplementary evidence rejects oversized or malformed base64", () => {
  assert.throws(() => decodeAIExaminerEvidenceUpload({
    base64: "***",
    fileName: "evidence.pdf",
    mimeType: "application/pdf",
  }));
  const bytes = Buffer.from("%PDF-1.4\n123456789", "ascii");
  assert.throws(() => decodeAIExaminerEvidenceUpload({
    base64: bytes.toString("base64"),
    fileName: "evidence.pdf",
    mimeType: "application/pdf",
    maximumBytes: 4,
  }));
});

test("external evidence references require credential-free HTTPS URLs", () => {
  assert.equal(normalizeAIExaminerEvidenceUrl("https://media.example.edu/evidence/clip.mp4"), "https://media.example.edu/evidence/clip.mp4");
  assert.throws(() => normalizeAIExaminerEvidenceUrl("http://media.example.edu/evidence/clip.mp4"));
  assert.throws(() => normalizeAIExaminerEvidenceUrl("https://user:pass@media.example.edu/evidence/clip.mp4"));
});
