import { parseAIExaminerExamProfile, type AIExaminerExamProfile } from "./ai-examiner-exam-profile.js";

export type AIExaminerRegradeScopeValue = "WHOLE_SCRIPT" | "QUESTION_SET" | "CLERICAL_CHECK";

export const DEFAULT_AI_EXAMINER_REGRADE_POLICY: AIExaminerExamProfile["regradePolicy"] = {
  enabled: false,
  requestWindowDays: 7,
  maxRequestsPerAnswerSheet: 1,
  allowStudentRequest: false,
  allowParentRequest: false,
  requireIndependentReviewer: true,
};

export function regradePolicyFromExamSnapshot(snapshot: unknown): AIExaminerExamProfile["regradePolicy"] {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return DEFAULT_AI_EXAMINER_REGRADE_POLICY;
  }
  const config = (snapshot as Record<string, unknown>).config;
  if (!config) return DEFAULT_AI_EXAMINER_REGRADE_POLICY;
  try {
    return parseAIExaminerExamProfile(config).regradePolicy;
  } catch {
    // Malformed historical profile snapshots fail closed for student/parent regrade requests.
    return DEFAULT_AI_EXAMINER_REGRADE_POLICY;
  }
}

export function normalizeAIExaminerRegradeQuestionKeys(input: {
  scope: AIExaminerRegradeScopeValue;
  questionKeys?: string[];
  availableQuestionKeys: string[];
}) {
  const available = new Map(input.availableQuestionKeys.map(key => [key.trim().toLowerCase(), key.trim()]));
  const supplied = input.questionKeys ?? [];
  const unique = new Map<string, string>();

  for (const raw of supplied) {
    const normalized = raw.trim().toLowerCase();
    if (!normalized) throw new Error("Regrade question keys must be non-empty");
    const canonical = available.get(normalized);
    if (!canonical) throw new Error(`Unknown regrade question key: ${raw.trim()}`);
    unique.set(normalized, canonical);
  }

  if (input.scope === "QUESTION_SET" && unique.size === 0) {
    throw new Error("Question-set regrade requires at least one question key");
  }
  if (input.scope !== "QUESTION_SET" && unique.size > 0) {
    throw new Error("Question keys are only supported for QUESTION_SET regrade scope");
  }

  return [...unique.values()];
}

export function aiExaminerRegradeWindow(input: {
  publishedAt: Date | null;
  requestWindowDays: number;
  now?: Date;
}) {
  if (!input.publishedAt) return { open: false, closesAt: null as Date | null, reason: "RESULT_PUBLICATION_TIME_UNAVAILABLE" as const };
  const now = input.now ?? new Date();
  const closesAt = new Date(input.publishedAt.getTime() + input.requestWindowDays * 24 * 60 * 60 * 1000);
  return {
    open: now <= closesAt,
    closesAt,
    reason: now <= closesAt ? null : "REGRADE_WINDOW_CLOSED" as const,
  };
}

export function resultRevisionSnapshot(result: {
  marksObtained: unknown;
  percentage: unknown;
  grade: string | null;
  gpa: unknown;
  rank: number | null;
  status: string;
  remarks: string | null;
  generatedAt: Date | null;
}) {
  const numberOrNull = (value: unknown) => value == null ? null : Number(value);
  return {
    marksObtained: numberOrNull(result.marksObtained),
    percentage: numberOrNull(result.percentage),
    grade: result.grade,
    gpa: numberOrNull(result.gpa),
    rank: result.rank,
    status: result.status,
    remarks: result.remarks,
    generatedAt: result.generatedAt?.toISOString() ?? null,
  };
}
