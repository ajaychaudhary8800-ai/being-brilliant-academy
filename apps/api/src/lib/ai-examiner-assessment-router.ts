export const AI_EXAMINER_QUESTION_TYPES = [
  "MCQ",
  "MSQ",
  "TRUE_FALSE",
  "ASSERTION_REASON",
  "FILL_BLANK",
  "MATCHING",
  "ONE_WORD",
  "NUMERICAL",
  "SHORT_ANSWER",
  "LONG_ANSWER",
  "CASE_STUDY",
  "DERIVATION",
  "PROOF",
  "CALCULATION",
  "DIAGRAM",
  "GRAPH",
  "MAP",
  "GEOMETRY_CONSTRUCTION",
  "CHEMISTRY_EQUATION",
  "ACCOUNTING_STATEMENT",
  "PROGRAMMING",
  "ESSAY",
  "LANGUAGE",
  "ORAL_AUDIO_VIDEO",
  "PRACTICAL_PROJECT_VIVA",
  "EARLY_YEARS_VISUAL",
] as const;

export type AIExaminerQuestionType = typeof AI_EXAMINER_QUESTION_TYPES[number];

export const AI_EXAMINER_ENGINES = [
  "DETERMINISTIC_OBJECTIVE",
  "DETERMINISTIC_NUMERIC",
  "SPECIALIZED_SYMBOLIC",
  "RUBRIC_SEMANTIC",
  "MULTIMODAL",
  "CODE_SANDBOX",
] as const;

export type AIExaminerEngineKind = typeof AI_EXAMINER_ENGINES[number];

export type AIExaminerQuestionRoutingInput = {
  questionType: AIExaminerQuestionType;
  requiresVisualEvidence?: boolean;
  requiresCodeExecution?: boolean;
};

export type AIExaminerQuestionRoute = {
  engine: AIExaminerEngineKind;
  deterministic: boolean;
  humanReviewRequired: boolean;
  reason: string;
};

const OBJECTIVE_TYPES = new Set<AIExaminerQuestionType>([
  "MCQ",
  "MSQ",
  "TRUE_FALSE",
  "ASSERTION_REASON",
  "FILL_BLANK",
  "MATCHING",
  "ONE_WORD",
]);

const SYMBOLIC_TYPES = new Set<AIExaminerQuestionType>([
  "DERIVATION",
  "PROOF",
  "CALCULATION",
  "CHEMISTRY_EQUATION",
  "ACCOUNTING_STATEMENT",
]);

const MULTIMODAL_TYPES = new Set<AIExaminerQuestionType>([
  "DIAGRAM",
  "GRAPH",
  "MAP",
  "GEOMETRY_CONSTRUCTION",
  "ORAL_AUDIO_VIDEO",
  "PRACTICAL_PROJECT_VIVA",
  "EARLY_YEARS_VISUAL",
]);

export function routeAIExaminerQuestion(input: AIExaminerQuestionRoutingInput): AIExaminerQuestionRoute {
  if (input.requiresCodeExecution || input.questionType === "PROGRAMMING") {
    return {
      engine: "CODE_SANDBOX",
      deterministic: false,
      humanReviewRequired: true,
      reason: "Programming answers require isolated test-case execution and teacher-supervised review.",
    };
  }

  if (input.requiresVisualEvidence || MULTIMODAL_TYPES.has(input.questionType)) {
    return {
      engine: "MULTIMODAL",
      deterministic: false,
      humanReviewRequired: true,
      reason: "The response depends on visual, audio, video, practical, or developmental evidence.",
    };
  }

  if (OBJECTIVE_TYPES.has(input.questionType)) {
    return {
      engine: "DETERMINISTIC_OBJECTIVE",
      deterministic: true,
      humanReviewRequired: false,
      reason: "The response can be scored from explicit answer keys and configured marking rules.",
    };
  }

  if (input.questionType === "NUMERICAL") {
    return {
      engine: "DETERMINISTIC_NUMERIC",
      deterministic: true,
      humanReviewRequired: false,
      reason: "The response can be scored deterministically using configured numerical tolerances.",
    };
  }

  if (SYMBOLIC_TYPES.has(input.questionType)) {
    return {
      engine: "SPECIALIZED_SYMBOLIC",
      deterministic: false,
      humanReviewRequired: true,
      reason: "The response requires subject-specific symbolic or structured validation before marks are finalized.",
    };
  }

  return {
    engine: "RUBRIC_SEMANTIC",
    deterministic: false,
    humanReviewRequired: true,
    reason: "The response requires rubric-semantic evaluation with evidence and teacher supervision.",
  };
}
