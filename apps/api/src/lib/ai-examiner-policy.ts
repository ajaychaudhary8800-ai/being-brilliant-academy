import { AIExaminerEvaluationStatus, AIExaminerRubricStatus, ExaminationStatus } from "@prisma/client";
import { AppError } from "./http.js";

export function aiExaminerLifecycleBlocker(status: ExaminationStatus) {
  if (status === ExaminationStatus.COMPLETED) return null;
  if (status === ExaminationStatus.RESULTS_PUBLISHED) return "Results are published; new AI evaluations are closed";
  if (status === ExaminationStatus.ARCHIVED) return "Archived examinations cannot start AI evaluation";
  return "Complete the examination before AI evaluation";
}

export function assertAIExaminerRubricActivatable(input: {
  status: AIExaminerRubricStatus;
  examinationStatus: ExaminationStatus;
  maximumMarks: number;
  rubricMaximumMarks: number;
}) {
  if (input.status !== AIExaminerRubricStatus.DRAFT) {
    throw new AppError(409, "AI_EXAMINER_RUBRIC_NOT_DRAFT", "Only a draft rubric can be activated");
  }
  if (input.examinationStatus === ExaminationStatus.ARCHIVED) {
    throw new AppError(409, "AI_EXAMINER_EXAM_ARCHIVED", "Archived examinations cannot activate an AI Examiner rubric");
  }
  if (Math.abs(input.maximumMarks - input.rubricMaximumMarks) > 0.001) {
    throw new AppError(422, "AI_EXAMINER_RUBRIC_MARKS_MISMATCH", "Rubric marks must equal the examination maximum marks");
  }
}

export function assertAIExaminerEvaluationReady(input: {
  examinationStatus: ExaminationStatus;
  questionPaperPublished: boolean;
  rubricStatus: AIExaminerRubricStatus | null;
  finalizedAt: Date | null;
}) {
  if (input.examinationStatus !== ExaminationStatus.COMPLETED) {
    throw new AppError(409, "AI_EXAMINER_EXAM_NOT_COMPLETED", "AI evaluation is available only after the examination is completed");
  }
  if (!input.questionPaperPublished) {
    throw new AppError(409, "AI_EXAMINER_QUESTION_PAPER_REQUIRED", "Publish the question paper before AI evaluation");
  }
  if (input.rubricStatus !== AIExaminerRubricStatus.ACTIVE) {
    throw new AppError(409, "AI_EXAMINER_ACTIVE_RUBRIC_REQUIRED", "Activate a marking rubric before AI evaluation");
  }
  if (input.finalizedAt) {
    throw new AppError(409, "AI_EXAMINER_ANSWER_FINALIZED", "Finalized answer sheets cannot be re-evaluated by AI");
  }
}

export function assertAIExaminerReviewable(status: AIExaminerEvaluationStatus) {
  if (status !== AIExaminerEvaluationStatus.REVIEW_REQUIRED && status !== AIExaminerEvaluationStatus.APPROVED) {
    throw new AppError(409, "AI_EXAMINER_REVIEW_UNAVAILABLE", "This AI evaluation is not ready for teacher review");
  }
}

export function aiExaminerConfidenceNeedsReview(confidence: number | null | undefined, threshold = 0.75) {
  return confidence == null || confidence < threshold;
}
