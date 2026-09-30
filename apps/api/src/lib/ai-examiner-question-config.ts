import { z } from "zod";
import {
  AI_EXAMINER_QUESTION_TYPES,
  routeAIExaminerQuestion,
  type AIExaminerQuestionType,
} from "./ai-examiner-assessment-router.js";

export const aiExaminerQuestionTypeSchema = z.enum(AI_EXAMINER_QUESTION_TYPES);

const aiExaminerAnswerKeyScalarSchema = z.union([
  z.string().max(12000),
  z.number().finite(),
  z.boolean(),
]);
export const aiExaminerAnswerKeySchema = z.union([
  aiExaminerAnswerKeyScalarSchema,
  z.array(aiExaminerAnswerKeyScalarSchema).max(200),
  z.record(aiExaminerAnswerKeyScalarSchema),
]);

export const aiExaminerChemistryValidationSchema = z.object({
  expectedEquation: z.string().trim().min(1).max(12000).optional(),
  requireBalanced: z.boolean().default(true),
  allowReverse: z.boolean().default(false),
});

export const aiExaminerStemValidationSchema = z.object({
  expectedExpression: z.string().trim().min(1).max(12000).optional(),
  expectedNumericValue: z.coerce.number().finite().optional(),
  numericalTolerance: z.object({
    absolute: z.coerce.number().min(0).max(1_000_000_000).default(0),
    relative: z.coerce.number().min(0).max(1).default(0),
  }).optional(),
  expectedUnit: z.string().trim().min(1).max(120).optional(),
  acceptedUnits: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  unitRequired: z.boolean().optional(),
  expectedSign: z.enum(["POSITIVE", "NEGATIVE", "ZERO", "NONZERO", "ANY"]).optional(),
  significantFigures: z.object({
    count: z.coerce.number().int().min(1).max(20),
    mode: z.enum(["EXACT", "AT_LEAST"]).default("EXACT"),
  }).optional(),
  stepCriteria: z.array(z.object({
    key: z.string().trim().min(1).max(80),
    marks: z.coerce.number().positive().max(10000),
    evidence: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  })).max(50).default([]),
}).superRefine((value, ctx) => {
  const configured = Boolean(
    value.expectedExpression ||
    value.expectedNumericValue != null ||
    value.expectedUnit ||
    value.expectedSign ||
    value.significantFigures ||
    value.stepCriteria.length
  );
  if (!configured) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "STEM validation requires at least one configured verification rule",
    });
  }
});

export const aiExaminerScoringRuleSchema = z.object({
  correctMarks: z.coerce.number().min(0).max(10000).optional(),
  incorrectMarks: z.coerce.number().min(-10000).max(10000).optional(),
  unansweredMarks: z.coerce.number().min(-10000).max(10000).optional(),
  partialMode: z.enum(["NONE", "PROPORTIONAL_NO_WRONG", "PROPORTIONAL_WITH_PENALTY"]).default("NONE"),
  caseSensitive: z.boolean().default(false),
  trimWhitespace: z.boolean().default(true),
  numericalTolerance: z.object({
    absolute: z.coerce.number().min(0).max(1_000_000_000).default(0),
    relative: z.coerce.number().min(0).max(1).default(0),
  }).default({ absolute: 0, relative: 0 }),
}).optional();

export const aiExaminerRubricQuestionInputSchema = z.object({
  key: z.string().trim().min(1).max(40),
  maxMarks: z.coerce.number().positive().max(10000),
  criteria: z.string().trim().min(2).max(4000),
  modelAnswer: z.string().trim().max(12000).nullable().optional(),
  concepts: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  questionType: aiExaminerQuestionTypeSchema.default("LONG_ANSWER"),
  answerKey: aiExaminerAnswerKeySchema.optional(),
  scoring: aiExaminerScoringRuleSchema,
  requiresVisualEvidence: z.boolean().default(false),
  requiresCodeExecution: z.boolean().default(false),
  stemValidation: aiExaminerStemValidationSchema.optional(),
  chemistryValidation: aiExaminerChemistryValidationSchema.optional(),
}).superRefine((question, ctx) => {
  const route = routeAIExaminerQuestion({
    questionType: question.questionType,
    requiresVisualEvidence: question.requiresVisualEvidence,
    requiresCodeExecution: question.requiresCodeExecution,
  });

  if (question.scoring?.correctMarks != null && question.scoring.correctMarks > question.maxMarks) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scoring", "correctMarks"],
      message: "Correct marks cannot exceed question maximum marks",
    });
  }

  const structuredAnswerKeyRequired = question.questionType === "MSQ" || question.questionType === "MATCHING";
  if (route.deterministic && question.answerKey === undefined && (structuredAnswerKeyRequired || !question.modelAnswer?.trim())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["answerKey"],
      message: structuredAnswerKeyRequired
        ? "MSQ and matching questions require a structured answer key"
        : "Deterministic question types require an answer key or model answer",
    });
  }

  if (question.scoring?.incorrectMarks != null && question.scoring.incorrectMarks < -question.maxMarks) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scoring", "incorrectMarks"],
      message: "Incorrect-answer penalty cannot be less than negative maximum marks",
    });
  }

  if (question.scoring?.unansweredMarks != null && question.scoring.unansweredMarks < -question.maxMarks) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scoring", "unansweredMarks"],
      message: "Unanswered penalty cannot be less than negative maximum marks",
    });
  }

  if (question.stemValidation && !["DERIVATION", "PROOF", "CALCULATION"].includes(question.questionType)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["stemValidation"],
      message: "STEM validation is only supported for calculation, derivation and proof questions",
    });
  }

  if (question.chemistryValidation && question.questionType !== "CHEMISTRY_EQUATION") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["chemistryValidation"],
      message: "Chemistry equation validation is only supported for CHEMISTRY_EQUATION questions",
    });
  }

  if (question.questionType === "MSQ" && question.answerKey !== undefined && !Array.isArray(question.answerKey)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["answerKey"],
      message: "MSQ answer key must be an array of correct options",
    });
  }

  if (
    question.questionType === "MATCHING" &&
    question.answerKey !== undefined &&
    (!question.answerKey || typeof question.answerKey !== "object" || Array.isArray(question.answerKey))
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["answerKey"],
      message: "Matching answer key must be an object of source-to-target pairs",
    });
  }
});

export const aiExaminerRubricInputSchema = z.object({
  instructions: z.string().trim().max(5000).nullable().optional(),
  questions: z.array(aiExaminerRubricQuestionInputSchema).min(1).max(200),
}).superRefine((value, ctx) => {
  const keys = new Set<string>();
  value.questions.forEach((question, index) => {
    const normalized = question.key.toLowerCase();
    if (keys.has(normalized)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["questions", index, "key"],
        message: "Question keys must be unique",
      });
    }
    keys.add(normalized);
  });
});

export type AIExaminerRubricInput = z.infer<typeof aiExaminerRubricInputSchema>;
export type AIExaminerRubricQuestionInput = z.infer<typeof aiExaminerRubricQuestionInputSchema>;

export function aiExaminerRubricStorage(input: AIExaminerRubricInput) {
  return {
    rubric: {
      questions: input.questions.map(({ modelAnswer, ...question }) => question),
    },
    modelAnswer: {
      questions: input.questions
        .filter(question => question.modelAnswer)
        .map(question => ({ key: question.key, answer: question.modelAnswer })),
    },
  };
}

export function aiExaminerStoredQuestionRoute(question: {
  questionType?: AIExaminerQuestionType;
  requiresVisualEvidence?: boolean;
  requiresCodeExecution?: boolean;
}) {
  return routeAIExaminerQuestion({
    questionType: question.questionType ?? "LONG_ANSWER",
    requiresVisualEvidence: question.requiresVisualEvidence ?? false,
    requiresCodeExecution: question.requiresCodeExecution ?? false,
  });
}
