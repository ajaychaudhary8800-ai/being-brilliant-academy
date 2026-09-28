import assert from "node:assert/strict";
import test from "node:test";
import { AIExaminerEvaluationStatus, AIExaminerRubricStatus, ExaminationStatus } from "@prisma/client";
import { AppError } from "./http.js";
import {
  aiExaminerConfidenceNeedsReview,
  assertAIExaminerEvaluationReady,
  assertAIExaminerReviewable,
  assertAIExaminerRubricActivatable,
} from "./ai-examiner-policy.js";

function expectCode(fn: () => void, code: string) {
  assert.throws(fn, (error: unknown) => error instanceof AppError && error.code === code);
}

test("AI Examiner rubric activation requires a draft rubric with exact examination marks", () => {
  assert.doesNotThrow(() => assertAIExaminerRubricActivatable({
    status: AIExaminerRubricStatus.DRAFT,
    examinationStatus: ExaminationStatus.DRAFT,
    maximumMarks: 70,
    rubricMaximumMarks: 70,
  }));
  expectCode(() => assertAIExaminerRubricActivatable({
    status: AIExaminerRubricStatus.ACTIVE,
    examinationStatus: ExaminationStatus.DRAFT,
    maximumMarks: 70,
    rubricMaximumMarks: 70,
  }), "AI_EXAMINER_RUBRIC_NOT_DRAFT");
  expectCode(() => assertAIExaminerRubricActivatable({
    status: AIExaminerRubricStatus.DRAFT,
    examinationStatus: ExaminationStatus.DRAFT,
    maximumMarks: 70,
    rubricMaximumMarks: 69,
  }), "AI_EXAMINER_RUBRIC_MARKS_MISMATCH");
});

test("AI Examiner evaluation requires completed exam, paper, active rubric and unfinalized answer", () => {
  assert.doesNotThrow(() => assertAIExaminerEvaluationReady({
    examinationStatus: ExaminationStatus.COMPLETED,
    questionPaperPublished: true,
    rubricStatus: AIExaminerRubricStatus.ACTIVE,
    finalizedAt: null,
  }));
  expectCode(() => assertAIExaminerEvaluationReady({
    examinationStatus: ExaminationStatus.SCHEDULED,
    questionPaperPublished: true,
    rubricStatus: AIExaminerRubricStatus.ACTIVE,
    finalizedAt: null,
  }), "AI_EXAMINER_EXAM_NOT_COMPLETED");
  expectCode(() => assertAIExaminerEvaluationReady({
    examinationStatus: ExaminationStatus.COMPLETED,
    questionPaperPublished: false,
    rubricStatus: AIExaminerRubricStatus.ACTIVE,
    finalizedAt: null,
  }), "AI_EXAMINER_QUESTION_PAPER_REQUIRED");
  expectCode(() => assertAIExaminerEvaluationReady({
    examinationStatus: ExaminationStatus.COMPLETED,
    questionPaperPublished: true,
    rubricStatus: AIExaminerRubricStatus.DRAFT,
    finalizedAt: null,
  }), "AI_EXAMINER_ACTIVE_RUBRIC_REQUIRED");
});

test("AI Examiner low confidence always requires human review", () => {
  assert.equal(aiExaminerConfidenceNeedsReview(null), true);
  assert.equal(aiExaminerConfidenceNeedsReview(0.74), true);
  assert.equal(aiExaminerConfidenceNeedsReview(0.75), false);
});

test("AI Examiner review is limited to completed AI suggestions", () => {
  assert.doesNotThrow(() => assertAIExaminerReviewable(AIExaminerEvaluationStatus.REVIEW_REQUIRED));
  assert.doesNotThrow(() => assertAIExaminerReviewable(AIExaminerEvaluationStatus.APPROVED));
  expectCode(() => assertAIExaminerReviewable(AIExaminerEvaluationStatus.PROCESSING), "AI_EXAMINER_REVIEW_UNAVAILABLE");
});
