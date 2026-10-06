import {
  parseAIExaminerExamProfile,
  reviewDiscrepancyRequiresModeration,
  type AIExaminerExamProfile,
} from "./ai-examiner-exam-profile.js";

export type AIExaminerReviewRoundSummary = {
  reviewerId: string;
  kind: "PRIMARY" | "SECONDARY" | "MODERATION" | "APPEAL";
  status: "ASSIGNED" | "IN_PROGRESS" | "SUBMITTED" | "CANCELLED";
  totalMarks: number | null;
};

export type AIExaminerReviewCompletion = {
  policy: AIExaminerExamProfile["reviewPolicy"];
  readyToFinalize: boolean;
  requiredIndependentReviewers: number;
  submittedIndependentReviewers: number;
  moderationRequired: boolean;
  moderationSubmitted: boolean;
  blockers: string[];
};

const standardPolicy: AIExaminerExamProfile["reviewPolicy"] = {
  mode: "STANDARD",
  independentReviewers: 1,
  anonymizeStudentIdentity: false,
  reviewersSeePriorMarks: true,
  moderationRequired: false,
  discrepancyThresholdMarks: 0,
  discrepancyThresholdRatio: 0,
};

export function reviewPolicyFromExamSnapshot(snapshot: unknown): AIExaminerExamProfile["reviewPolicy"] {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return standardPolicy;
  const config = (snapshot as Record<string, unknown>).config;
  if (!config) return standardPolicy;
  return parseAIExaminerExamProfile(config).reviewPolicy;
}

export function assessAIExaminerReviewCompletion(input: {
  policy: AIExaminerExamProfile["reviewPolicy"];
  rounds: AIExaminerReviewRoundSummary[];
  maximumMarks: number;
}): AIExaminerReviewCompletion {
  if (input.policy.mode === "STANDARD") {
    return {
      policy: input.policy,
      readyToFinalize: true,
      requiredIndependentReviewers: 0,
      submittedIndependentReviewers: 0,
      moderationRequired: false,
      moderationSubmitted: false,
      blockers: [],
    };
  }

  const submitted = input.rounds.filter(round => round.status === "SUBMITTED");
  const independent = submitted.filter(round => round.kind !== "MODERATION" && round.kind !== "APPEAL");
  const distinctReviewers = new Set(independent.map(round => round.reviewerId));
  const marks = independent
    .map(round => round.totalMarks)
    .filter((value): value is number => value != null && Number.isFinite(value));

  const moderationRequired = reviewDiscrepancyRequiresModeration({
    policy: input.policy,
    marks,
    maximumMarks: input.maximumMarks,
  });
  const moderationSubmitted = submitted.some(round => round.kind === "MODERATION");
  const blockers: string[] = [];

  if (distinctReviewers.size < input.policy.independentReviewers) {
    blockers.push(`Requires ${input.policy.independentReviewers} independent submitted reviewer(s); ${distinctReviewers.size} complete.`);
  }
  if (moderationRequired && !moderationSubmitted) {
    blockers.push("A submitted moderation round is required before finalization.");
  }

  return {
    policy: input.policy,
    readyToFinalize: blockers.length === 0,
    requiredIndependentReviewers: input.policy.independentReviewers,
    submittedIndependentReviewers: distinctReviewers.size,
    moderationRequired,
    moderationSubmitted,
    blockers,
  };
}
