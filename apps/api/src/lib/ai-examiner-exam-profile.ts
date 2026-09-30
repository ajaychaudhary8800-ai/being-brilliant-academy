import { z } from "zod";
import {
  aiExaminerScoringRuleSchema,
  aiExaminerQuestionTypeSchema,
} from "./ai-examiner-question-config.js";

export const AI_EXAMINER_EXAM_PROFILE_KINDS = [
  "SCHOOL",
  "CBSE",
  "ICSE",
  "ISC",
  "JEE_MAIN",
  "JEE_ADVANCED",
  "NEET",
  "NDA",
  "CUET",
  "INSTITUTION_DEFINED",
] as const;

export type AIExaminerExamProfileKind = typeof AI_EXAMINER_EXAM_PROFILE_KINDS[number];

const questionRuleSchema = z.object({
  questionType: aiExaminerQuestionTypeSchema,
  scoring: aiExaminerScoringRuleSchema.unwrap(),
  maxMarks: z.coerce.number().positive().max(10000).optional(),
});

const sectionRuleSchema = z.object({
  key: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(160),
  questionTypes: z.array(aiExaminerQuestionTypeSchema).min(1).max(30),
  attemptLimit: z.coerce.number().int().positive().max(500).optional(),
  scoring: aiExaminerScoringRuleSchema.unwrap().optional(),
});

export const aiExaminerExamProfileSchema = z.object({
  code: z.string().trim().min(2).max(80).regex(/^[A-Z0-9][A-Z0-9_-]*$/),
  name: z.string().trim().min(2).max(160),
  kind: z.enum(AI_EXAMINER_EXAM_PROFILE_KINDS),
  version: z.string().trim().min(1).max(80),
  effectiveFrom: z.coerce.date().optional(),
  effectiveTo: z.coerce.date().optional(),
  institutionDefined: z.boolean().default(false),
  highStakes: z.boolean().default(false),
  questionRules: z.array(questionRuleSchema).max(100).default([]),
  sections: z.array(sectionRuleSchema).max(50).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).superRefine((profile, ctx) => {
  if (profile.kind === "INSTITUTION_DEFINED" && !profile.institutionDefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["institutionDefined"],
      message: "Institution-defined profiles must explicitly set institutionDefined=true",
    });
  }
  if (profile.kind !== "INSTITUTION_DEFINED" && profile.institutionDefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["institutionDefined"],
      message: "Only institution-defined profiles may set institutionDefined=true",
    });
  }
  if (profile.effectiveFrom && profile.effectiveTo && profile.effectiveTo < profile.effectiveFrom) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["effectiveTo"],
      message: "effectiveTo cannot be earlier than effectiveFrom",
    });
  }

  const questionTypes = new Set<string>();
  profile.questionRules.forEach((rule, index) => {
    if (questionTypes.has(rule.questionType)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["questionRules", index, "questionType"],
        message: "Question type can have only one profile-level scoring rule",
      });
    }
    questionTypes.add(rule.questionType);
  });

  const sectionKeys = new Set<string>();
  profile.sections.forEach((section, index) => {
    const normalized = section.key.toLowerCase();
    if (sectionKeys.has(normalized)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sections", index, "key"],
        message: "Section keys must be unique",
      });
    }
    sectionKeys.add(normalized);
  });
});

export type AIExaminerExamProfile = z.infer<typeof aiExaminerExamProfileSchema>;

export type AIExaminerResolvedMarkingRule = {
  source: "QUESTION" | "SECTION" | "PROFILE" | "DEFAULT";
  scoring: NonNullable<z.infer<typeof aiExaminerScoringRuleSchema>>;
};

export function resolveAIExaminerMarkingRule(input: {
  profile: AIExaminerExamProfile;
  questionType: z.infer<typeof aiExaminerQuestionTypeSchema>;
  sectionKey?: string | null;
  questionScoring?: z.infer<typeof aiExaminerScoringRuleSchema>;
}): AIExaminerResolvedMarkingRule {
  if (input.questionScoring) return { source: "QUESTION", scoring: input.questionScoring };

  if (input.sectionKey) {
    const section = input.profile.sections.find(row => row.key === input.sectionKey);
    if (section?.scoring && section.questionTypes.includes(input.questionType)) {
      return { source: "SECTION", scoring: section.scoring };
    }
  }

  const profileRule = input.profile.questionRules.find(row => row.questionType === input.questionType);
  if (profileRule) return { source: "PROFILE", scoring: profileRule.scoring };

  return {
    source: "DEFAULT",
    scoring: {
      correctMarks: undefined,
      incorrectMarks: undefined,
      unansweredMarks: undefined,
      partialMode: "NONE",
      caseSensitive: false,
      trimWhitespace: true,
      numericalTolerance: { absolute: 0, relative: 0 },
    },
  };
}

export function parseAIExaminerExamProfile(input: unknown): AIExaminerExamProfile {
  return aiExaminerExamProfileSchema.parse(input);
}
