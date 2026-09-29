import { z } from "zod";
import {
  AI_EXAMINER_QUESTION_TYPES,
  routeAIExaminerQuestion,
  type AIExaminerQuestionType,
} from "./ai-examiner-assessment-router.js";

export const aiExaminerQuestionTypeSchema = z.enum(AI_EXAMINER_QUESTION_TYPES);

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
  answerKey: z.unknown().optional(),
  scoring: aiExaminerScoringRuleSchema,
  requiresVisualEvidence: z.boolean().default(false),
  requiresCodeExecution: z.boolean().default(false),
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

  if (route.deterministic && question.answerKey === undefined && !question.modelAnswer?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["answerKey"],
      message: "Deterministic question types require an answer key or model answer",
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
