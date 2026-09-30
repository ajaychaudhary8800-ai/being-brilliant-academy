import assert from "node:assert/strict";
import test from "node:test";
import {
  AIExaminerScanBindingError,
  assertAIExaminerScanToken,
  createAIExaminerScanToken,
  hashAIExaminerScanToken,
  validateAIExaminerOmrIngestion,
} from "./ai-examiner-scan-ingestion.js";

const questions = [
  { questionKey: "Q1", mode: "MCQ" as const, allowedOptions: ["A", "B", "C", "D"] },
  { questionKey: "Q2", mode: "MSQ" as const, allowedOptions: ["A", "B", "C", "D"] },
];

test("scan tokens are opaque and validated by hash without storing the raw token", () => {
  const token = createAIExaminerScanToken();
  assert.ok(token.length >= 32);
  const hash = hashAIExaminerScanToken(token);
  assert.equal(hash.length, 64);
  assert.doesNotThrow(() => assertAIExaminerScanToken(hash, token));
  assert.throws(
    () => assertAIExaminerScanToken(hash, createAIExaminerScanToken()),
    (error: unknown) => error instanceof AIExaminerScanBindingError && error.code === "AI_EXAMINER_SCAN_TOKEN_MISMATCH",
  );
});

test("clean MCQ and MSQ detections are accepted for deterministic scoring", () => {
  const result = validateAIExaminerOmrIngestion({
    questions,
    payload: {
      scanId: "scan-1",
      scannerEngine: "fixture",
      scannerVersion: "1",
      pageNumber: 1,
      totalPages: 1,
      scanToken: createAIExaminerScanToken(),
      barcodeConfidence: 0.99,
      imageQuality: 0.98,
      detections: [
        { questionKey: "Q1", selections: ["b"], confidence: 0.97 },
        { questionKey: "Q2", selections: ["A", "c"], confidence: 0.95 },
      ],
    },
  });

  assert.equal(result.status, "ACCEPTED");
  assert.deepEqual(result.answers[0]?.selections, ["B"]);
  assert.deepEqual(result.answers[1]?.selections, ["A", "C"]);
  assert.equal(result.answers.every(answer => answer.autoScorable), true);
});

test("ambiguous, low-confidence and invalid OMR marks never become auto-scorable", () => {
  const result = validateAIExaminerOmrIngestion({
    questions,
    payload: {
      scanId: "scan-2",
      scannerEngine: "fixture",
      scannerVersion: "1",
      pageNumber: 1,
      totalPages: 1,
      scanToken: createAIExaminerScanToken(),
      barcodeConfidence: 0.7,
      imageQuality: 0.6,
      detections: [
        { questionKey: "Q1", selections: ["A", "B"], confidence: 0.7, ambiguous: true },
        { questionKey: "Q2", selections: ["Z"], confidence: 0.95 },
      ],
    },
  });

  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.answers.every(answer => answer.autoScorable === false), true);
  const codes = new Set(result.issues.map(issue => issue.code));
  assert.ok(codes.has("LOW_BARCODE_CONFIDENCE"));
  assert.ok(codes.has("LOW_IMAGE_QUALITY"));
  assert.ok(codes.has("LOW_MARK_CONFIDENCE"));
  assert.ok(codes.has("AMBIGUOUS_MARK"));
  assert.ok(codes.has("MCQ_MULTIPLE_SELECTIONS"));
  assert.ok(codes.has("INVALID_OPTION"));
});

test("duplicate, unknown and missing question detections are routed to review", () => {
  const result = validateAIExaminerOmrIngestion({
    questions,
    payload: {
      scanId: "scan-3",
      scannerEngine: "fixture",
      scannerVersion: "1",
      pageNumber: 1,
      totalPages: 1,
      scanToken: createAIExaminerScanToken(),
      barcodeConfidence: 0.99,
      imageQuality: 0.99,
      detections: [
        { questionKey: "Q1", selections: ["A"], confidence: 0.99 },
        { questionKey: "q1", selections: ["B"], confidence: 0.99 },
        { questionKey: "Q99", selections: ["A"], confidence: 0.99 },
      ],
    },
  });

  assert.equal(result.status, "REVIEW_REQUIRED");
  const codes = result.issues.map(issue => issue.code);
  assert.ok(codes.includes("DUPLICATE_QUESTION"));
  assert.ok(codes.includes("UNKNOWN_QUESTION"));
  assert.ok(codes.includes("MISSING_QUESTION"));
});

test("invalid scan page metadata and confidence thresholds are rejected", () => {
  assert.throws(() => validateAIExaminerOmrIngestion({
    questions,
    minimumMarkConfidence: 1.1,
    payload: {
      scanId: "scan",
      scannerEngine: "fixture",
      scannerVersion: "1",
      pageNumber: 2,
      totalPages: 1,
      scanToken: createAIExaminerScanToken(),
      barcodeConfidence: 1,
      imageQuality: 1,
      detections: [],
    },
  }));
});
