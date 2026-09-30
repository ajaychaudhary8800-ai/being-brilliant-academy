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

export const AI_EXAMINER_REVIEW_MODES = ["STANDARD", "BLIND", "DOUBLE_BLIND", "COMMITTEE"] as const;
export type AIExaminerReviewMode = typeof AI_EXAMINER_REVIEW_MODES[number];

const reviewPolicySchema = z.object({
  mode: z.enum(AI_EXAMINER_REVIEW_MODES).default("STANDARD"),
  independentReviewers: z.coerce.number().int().min(1).max(10).default(1),
  anonymizeStudentIdentity: z.boolean().default(false),
  reviewersSeePriorMarks: z.boolean().default(true),
  moderationRequired: z.boolean().default(false),
  discrepancyThresholdMarks: z.coerce.number().min(0).max(10000).default(0),
  discrepancyThresholdRatio: z.coerce.number().min(0).max(1).default(0),
}).superRefine((policy, ctx) => {
  if (policy.mode === "BLIND" && !policy.anonymizeStudentIdentity) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["anonymizeStudentIdentity"],
      message: "Blind review must anonymize student identity",
    });
  }
  if (policy.mode === "DOUBLE_BLIND") {
    if (!policy.anonymizeStudentIdentity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["anonymizeStudentIdentity"],
        message: "Double-blind review must anonymize student identity",
      });
    }
    if (policy.independentReviewers < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["independentReviewers"],
        message: "Double-blind review requires at least two independent reviewers",
      });
    }
    if (policy.reviewersSeePriorMarks) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reviewersSeePriorMarks"],
        message: "Double-blind reviewers cannot see prior reviewer marks before submitting",
      });
    }
  }
  if (policy.mode === "COMMITTEE" && policy.independentReviewers < 3) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["independentReviewers"],
      message: "Committee review requires at least three reviewers",
    });
  }
});

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
  reviewPolicy: reviewPolicySchema.default({
    mode: "STANDARD",
    independentReviewers: 1,
    anonymizeStudentIdentity: false,
    reviewersSeePriorMarks: true,
    moderationRequired: false,
    discrepancyThresholdMarks: 0,
    discrepancyThresholdRatio: 0,
  }),
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


export function reviewDiscrepancyRequiresModeration(input: {
  policy: AIExaminerExamProfile["reviewPolicy"];
  marks: number[];
  maximumMarks: number;
}) {
  const finiteMarks = input.marks.filter(mark => Number.isFinite(mark));
  if (finiteMarks.length < 2) return input.policy.moderationRequired;
  const highest = Math.max(...finiteMarks);
  const lowest = Math.min(...finiteMarks);
  const difference = highest - lowest;
  const ratio = input.maximumMarks > 0 ? difference / input.maximumMarks : 0;

  return Boolean(
    input.policy.moderationRequired ||
    (input.policy.discrepancyThresholdMarks > 0 && difference > input.policy.discrepancyThresholdMarks) ||
    (input.policy.discrepancyThresholdRatio > 0 && ratio > input.policy.discrepancyThresholdRatio)
  );
}
