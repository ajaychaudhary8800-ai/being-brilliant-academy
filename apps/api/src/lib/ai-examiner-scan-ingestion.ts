import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type AIExaminerOmrQuestionConfig = {
  questionKey: string;
  mode: "MCQ" | "MSQ";
  allowedOptions: string[];
};

export type AIExaminerOmrDetection = {
  questionKey: string;
  selections: string[];
  confidence: number;
  ambiguous?: boolean;
};

export type AIExaminerScanPayload = {
  scanId: string;
  scannerEngine: string;
  scannerVersion: string;
  pageNumber: number;
  totalPages: number;
  scanToken: string;
  barcodeConfidence: number;
  imageQuality: number;
  detections: AIExaminerOmrDetection[];
};

export type AIExaminerOmrIngestionIssue = {
  code:
    | "LOW_BARCODE_CONFIDENCE"
    | "LOW_IMAGE_QUALITY"
    | "LOW_MARK_CONFIDENCE"
    | "AMBIGUOUS_MARK"
    | "DUPLICATE_QUESTION"
    | "UNKNOWN_QUESTION"
    | "INVALID_OPTION"
    | "MCQ_MULTIPLE_SELECTIONS"
    | "MISSING_QUESTION";
  questionKey?: string;
  message: string;
};

export type AIExaminerOmrIngestionResult = {
  status: "ACCEPTED" | "REVIEW_REQUIRED";
  answers: Array<{
    questionKey: string;
    selections: string[];
    confidence: number;
    autoScorable: boolean;
  }>;
  issues: AIExaminerOmrIngestionIssue[];
};

export class AIExaminerScanBindingError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AIExaminerScanBindingError";
  }
}

const TOKEN_BYTES = 32;

export function createAIExaminerScanToken() {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashAIExaminerScanToken(token: string) {
  const normalized = token.trim();
  if (normalized.length < 32 || normalized.length > 256) {
    throw new AIExaminerScanBindingError("AI_EXAMINER_SCAN_TOKEN_INVALID", "Scan token format is invalid");
  }
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function assertAIExaminerScanToken(expectedHash: string, providedToken: string) {
  const actualHash = hashAIExaminerScanToken(providedToken);
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(actualHash, "hex");
  if (expected.length !== 32 || actual.length !== 32 || !timingSafeEqual(expected, actual)) {
    throw new AIExaminerScanBindingError("AI_EXAMINER_SCAN_TOKEN_MISMATCH", "Scan token does not match the registered answer sheet");
  }
}

function normalizeOption(value: string) {
  return value.trim().toLocaleUpperCase("en");
}

export function validateAIExaminerOmrIngestion(input: {
  payload: AIExaminerScanPayload;
  questions: AIExaminerOmrQuestionConfig[];
  minimumBarcodeConfidence?: number;
  minimumImageQuality?: number;
  minimumMarkConfidence?: number;
}): AIExaminerOmrIngestionResult {
  const barcodeThreshold = input.minimumBarcodeConfidence ?? 0.9;
  const imageThreshold = input.minimumImageQuality ?? 0.75;
  const markThreshold = input.minimumMarkConfidence ?? 0.85;

  for (const threshold of [barcodeThreshold, imageThreshold, markThreshold]) {
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      throw new Error("OMR confidence thresholds must be between 0 and 1");
    }
  }
  if (!input.payload.scanId.trim() || !input.payload.scannerEngine.trim() || !input.payload.scannerVersion.trim()) {
    throw new Error("Scanner identity and scan ID are required");
  }
  if (
    !Number.isInteger(input.payload.pageNumber) ||
    !Number.isInteger(input.payload.totalPages) ||
    input.payload.pageNumber < 1 ||
    input.payload.totalPages < 1 ||
    input.payload.pageNumber > input.payload.totalPages
  ) {
    throw new Error("Scan page metadata is invalid");
  }

  const issues: AIExaminerOmrIngestionIssue[] = [];
  if (input.payload.barcodeConfidence < barcodeThreshold) {
    issues.push({ code: "LOW_BARCODE_CONFIDENCE", message: "Barcode/QR binding confidence is below the configured threshold." });
  }
  if (input.payload.imageQuality < imageThreshold) {
    issues.push({ code: "LOW_IMAGE_QUALITY", message: "Scan image quality is below the configured threshold." });
  }

  const expected = new Map<string, AIExaminerOmrQuestionConfig>();
  for (const question of input.questions) {
    const key = question.questionKey.trim().toLowerCase();
    if (!key || expected.has(key)) throw new Error("Expected OMR question keys must be non-empty and unique");
    const allowed = question.allowedOptions.map(normalizeOption);
    if (!allowed.length || new Set(allowed).size !== allowed.length || allowed.some(option => !option)) {
      throw new Error(`Allowed OMR options are invalid for ${question.questionKey}`);
    }
    expected.set(key, { ...question, allowedOptions: allowed });
  }

  const seen = new Set<string>();
  const answers: AIExaminerOmrIngestionResult["answers"] = [];

  for (const detection of input.payload.detections) {
    const normalizedKey = detection.questionKey.trim().toLowerCase();
    const config = expected.get(normalizedKey);

    if (seen.has(normalizedKey)) {
      issues.push({
        code: "DUPLICATE_QUESTION",
        questionKey: detection.questionKey,
        message: "Scanner returned more than one detection row for this question.",
      });
      continue;
    }
    seen.add(normalizedKey);

    if (!config) {
      issues.push({
        code: "UNKNOWN_QUESTION",
        questionKey: detection.questionKey,
        message: "Scanner returned a question that is not part of the configured OMR assessment.",
      });
      continue;
    }

    const selections = [...new Set(detection.selections.map(normalizeOption).filter(Boolean))];
    let autoScorable = true;

    if (!Number.isFinite(detection.confidence) || detection.confidence < markThreshold) {
      autoScorable = false;
      issues.push({
        code: "LOW_MARK_CONFIDENCE",
        questionKey: config.questionKey,
        message: "Bubble/mark confidence is below the configured threshold.",
      });
    }
    if (detection.ambiguous) {
      autoScorable = false;
      issues.push({
        code: "AMBIGUOUS_MARK",
        questionKey: config.questionKey,
        message: "Scanner marked this response as ambiguous.",
      });
    }

    const invalidOptions = selections.filter(option => !config.allowedOptions.includes(option));
    if (invalidOptions.length) {
      autoScorable = false;
      issues.push({
        code: "INVALID_OPTION",
        questionKey: config.questionKey,
        message: `Scanner returned unsupported option(s): ${invalidOptions.join(", ")}.`,
      });
    }

    if (config.mode === "MCQ" && selections.length > 1) {
      autoScorable = false;
      issues.push({
        code: "MCQ_MULTIPLE_SELECTIONS",
        questionKey: config.questionKey,
        message: "A single-choice MCQ contains multiple detected selections.",
      });
    }

    answers.push({
      questionKey: config.questionKey,
      selections,
      confidence: detection.confidence,
      autoScorable,
    });
  }

  for (const question of input.questions) {
    if (!seen.has(question.questionKey.trim().toLowerCase())) {
      issues.push({
        code: "MISSING_QUESTION",
        questionKey: question.questionKey,
        message: "No scanner detection row was returned for this configured question.",
      });
    }
  }

  return {
    status: issues.length ? "REVIEW_REQUIRED" : "ACCEPTED",
    answers,
    issues,
  };
}
