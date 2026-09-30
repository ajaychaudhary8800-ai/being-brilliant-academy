export type AIExaminerVerificationReason =
  | "HIGH_STAKES_ASSESSMENT"
  | "LOW_OVERALL_CONFIDENCE"
  | "LOW_QUESTION_CONFIDENCE"
  | "QUALITY_FLAG"
  | "SCORING_ERROR"
  | "SPECIALIZED_CHECK_FAILED"
  | "SPECIALIZED_CHECK_REVIEW"
  | "INCOMPLETE_MARKS";

export type AIExaminerSecondPassQuestion = {
  questionKey: string;
  confidence: number;
  suggestedMarks: number | null;
  flags?: string[];
  scoringError?: { code: string; message: string } | null;
  specializedEvidence?: {
    checks?: Array<{ status?: string }>;
    reviewRequired?: boolean;
  } | null;
};

export type AIExaminerSecondPassDecision = {
  required: boolean;
  reasons: AIExaminerVerificationReason[];
  questionKeys: string[];
  confidenceThreshold: number;
  highStakes: boolean;
};

export function decideAIExaminerSecondPass(input: {
  overallConfidence: number;
  questions: AIExaminerSecondPassQuestion[];
  confidenceThreshold: number;
  highStakes?: boolean;
}): AIExaminerSecondPassDecision {
  const threshold = input.confidenceThreshold;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("AI Examiner second-pass confidence threshold must be between 0 and 1");
  }
  if (!Number.isFinite(input.overallConfidence) || input.overallConfidence < 0 || input.overallConfidence > 1) {
    throw new Error("AI Examiner overall confidence must be between 0 and 1");
  }

  const reasons = new Set<AIExaminerVerificationReason>();
  const questionKeys = new Set<string>();
  const highStakes = Boolean(input.highStakes);

  if (highStakes) reasons.add("HIGH_STAKES_ASSESSMENT");
  if (input.overallConfidence < threshold) reasons.add("LOW_OVERALL_CONFIDENCE");

  for (const question of input.questions) {
    let include = highStakes;

    if (!Number.isFinite(question.confidence) || question.confidence < threshold) {
      reasons.add("LOW_QUESTION_CONFIDENCE");
      include = true;
    }
    if (question.suggestedMarks == null) {
      reasons.add("INCOMPLETE_MARKS");
      include = true;
    }
    if ((question.flags?.length ?? 0) > 0) {
      reasons.add("QUALITY_FLAG");
      include = true;
    }
    if (question.scoringError) {
      reasons.add("SCORING_ERROR");
      include = true;
    }

    const checks = question.specializedEvidence?.checks ?? [];
    if (checks.some(check => check.status === "FAIL")) {
      reasons.add("SPECIALIZED_CHECK_FAILED");
      include = true;
    }
    if (
      question.specializedEvidence?.reviewRequired ||
      checks.some(check => check.status === "REVIEW")
    ) {
      reasons.add("SPECIALIZED_CHECK_REVIEW");
      include = true;
    }

    if (include) questionKeys.add(question.questionKey);
  }

  return {
    required: reasons.size > 0,
    reasons: [...reasons],
    questionKeys: [...questionKeys],
    confidenceThreshold: threshold,
    highStakes,
  };
}
