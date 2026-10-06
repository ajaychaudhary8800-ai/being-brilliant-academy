import crypto from "node:crypto";
import { z } from "zod";

const accessibilitySchema = z.object({
  screenReaderOptimized: z.boolean().default(false),
  highContrast: z.boolean().default(false),
  fontScale: z.coerce.number().min(0.8).max(3).default(1),
  reducedMotion: z.boolean().default(false),
  keyboardOnly: z.boolean().default(false),
}).default({
  screenReaderOptimized: false,
  highContrast: false,
  fontScale: 1,
  reducedMotion: false,
  keyboardOnly: false,
});

const accommodationSchema = z.object({
  studentId: z.string().cuid(),
  extraTimeMinutes: z.coerce.number().int().min(0).max(720).default(0),
  availableFrom: z.coerce.date().nullable().optional(),
  availableUntil: z.coerce.date().nullable().optional(),
  maxAttemptsOverride: z.coerce.number().int().min(1).max(50).nullable().optional(),
  locale: z.string().trim().min(2).max(35).nullable().optional(),
  accessibility: accessibilitySchema,
}).superRefine((value, ctx) => {
  if (value.availableFrom && value.availableUntil && value.availableUntil <= value.availableFrom) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["availableUntil"],
      message: "Accommodation end time must be after its start time",
    });
  }
});

const adapterSchema = z.object({
  required: z.boolean().default(false),
  providerKey: z.string().trim().min(1).max(80).nullable().optional(),
}).default({ required: false });

export const learningTestDeliveryPolicySchema = z.object({
  version: z.literal(1).default(1),
  maxAttempts: z.coerce.number().int().min(1).max(50).nullable().default(null),
  shuffleQuestions: z.boolean().default(false),
  shuffleOptions: z.boolean().default(false),
  maxResumes: z.coerce.number().int().min(0).max(50).nullable().default(null),
  heartbeatIntervalSeconds: z.coerce.number().int().min(15).max(300).default(30),
  offlineGraceSeconds: z.coerce.number().int().min(0).max(3600).default(300),
  bindClientInstance: z.boolean().default(false),
  lockdown: adapterSchema,
  proctoring: adapterSchema,
  accommodations: z.array(accommodationSchema).max(5000).default([]),
}).superRefine((value, ctx) => {
  const seen = new Set<string>();
  value.accommodations.forEach((row, index) => {
    if (seen.has(row.studentId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accommodations", index, "studentId"],
        message: "Each student can have only one delivery accommodation per test",
      });
    }
    seen.add(row.studentId);
  });
  for (const [key, adapter] of [["lockdown", value.lockdown], ["proctoring", value.proctoring]] as const) {
    if (adapter.required && !adapter.providerKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key, "providerKey"],
        message: `${key} providerKey is required when the adapter is mandatory`,
      });
    }
  }
});

export type LearningTestDeliveryPolicy = z.infer<typeof learningTestDeliveryPolicySchema>;
export type LearningTestAccommodation = LearningTestDeliveryPolicy["accommodations"][number];

export type ResolvedLearningTestDelivery = {
  configured: boolean;
  policy: LearningTestDeliveryPolicy;
  accommodation: LearningTestAccommodation | null;
  maximumAttempts: number | null;
};

const LEGACY_POLICY = learningTestDeliveryPolicySchema.parse({});

export function resolveLearningTestDeliveryPolicy(value: unknown): { configured: boolean; policy: LearningTestDeliveryPolicy } {
  if (value === null || value === undefined) return { configured: false, policy: LEGACY_POLICY };
  return { configured: true, policy: learningTestDeliveryPolicySchema.parse(value) };
}

export function resolveLearningTestDeliveryForStudent(value: unknown, studentId: string): ResolvedLearningTestDelivery {
  const resolved = resolveLearningTestDeliveryPolicy(value);
  const accommodation = resolved.policy.accommodations.find(row => row.studentId === studentId) ?? null;
  return {
    ...resolved,
    accommodation,
    maximumAttempts: accommodation?.maxAttemptsOverride ?? resolved.policy.maxAttempts,
  };
}

export function learningTestAvailability(input: {
  testStartsAt?: Date | null;
  testEndsAt?: Date | null;
  accommodation?: LearningTestAccommodation | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const opensAt = input.accommodation?.availableFrom ?? input.testStartsAt ?? null;
  const closesAt = input.accommodation?.availableUntil ?? input.testEndsAt ?? null;
  return {
    opensAt,
    closesAt,
    open: (!opensAt || opensAt <= now) && (!closesAt || closesAt >= now),
  };
}

export function learningTestAttemptExpiry(input: {
  startedAt: Date;
  durationMinutes: number;
  accommodation?: LearningTestAccommodation | null;
  hardClosesAt?: Date | null;
}) {
  const duration = input.durationMinutes + (input.accommodation?.extraTimeMinutes ?? 0);
  const nominal = new Date(input.startedAt.getTime() + duration * 60_000);
  return input.hardClosesAt && input.hardClosesAt < nominal ? input.hardClosesAt : nominal;
}

function hashUnit(seed: string, index: number) {
  const digest = crypto.createHash("sha256").update(`${seed}:${index}`).digest();
  return digest.readUInt32BE(0) / 0x1_0000_0000;
}

export function stableSeededShuffle<T>(rows: readonly T[], seed: string) {
  const result = [...rows];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(hashUnit(seed, index) * (index + 1));
    [result[index], result[swap]] = [result[swap]!, result[index]!];
  }
  return result;
}

function canShufflePrimitiveOptions(value: unknown): value is Array<string | number | boolean> {
  return Array.isArray(value) && value.every(item =>
    typeof item === "string" || typeof item === "number" || typeof item === "boolean"
  );
}

export function prepareLearningTestDelivery<T extends {
  questionId: string;
  question: { options?: unknown };
}>(input: {
  questions: readonly T[];
  seed: string;
  policy: LearningTestDeliveryPolicy;
}) {
  const ordered = input.policy.shuffleQuestions
    ? stableSeededShuffle(input.questions, `${input.seed}:questions`)
    : [...input.questions];

  const optionShuffleSkippedQuestionIds: string[] = [];
  const questions = ordered.map((row, index) => {
    if (!input.policy.shuffleOptions || row.question.options == null) return row;
    if (!canShufflePrimitiveOptions(row.question.options)) {
      optionShuffleSkippedQuestionIds.push(row.questionId);
      return row;
    }
    return {
      ...row,
      question: {
        ...row.question,
        options: stableSeededShuffle(row.question.options, `${input.seed}:options:${row.questionId}:${index}`),
      },
    };
  });

  return { questions, optionShuffleSkippedQuestionIds };
}

export function learningTestOfflineLease(input: {
  now?: Date;
  policy: LearningTestDeliveryPolicy;
}) {
  const now = input.now ?? new Date();
  return new Date(now.getTime() + input.policy.offlineGraceSeconds * 1000);
}

export function learningTestResumeDecision(input: {
  configured: boolean;
  policy: LearningTestDeliveryPolicy;
  resumeCount: number;
  boundClientInstanceId?: string | null;
  requestedClientInstanceId?: string | null;
  offlineLeaseUntil?: Date | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  if (!input.configured) return { allowed: true as const, reason: null };
  if (input.policy.maxResumes !== null && input.resumeCount >= input.policy.maxResumes) {
    return { allowed: false as const, reason: "MAX_RESUMES_REACHED" };
  }
  if (
    input.policy.bindClientInstance &&
    input.boundClientInstanceId &&
    input.requestedClientInstanceId !== input.boundClientInstanceId
  ) {
    return { allowed: false as const, reason: "CLIENT_INSTANCE_MISMATCH" };
  }
  if (input.offlineLeaseUntil && input.offlineLeaseUntil < now) {
    return { allowed: false as const, reason: "OFFLINE_LEASE_EXPIRED" };
  }
  return { allowed: true as const, reason: null };
}

export function learningTestAdapterReadiness(policy: LearningTestDeliveryPolicy, availableProviderKeys: readonly string[]) {
  const available = new Set(availableProviderKeys);
  const blockers: string[] = [];
  for (const [kind, adapter] of [["lockdown", policy.lockdown], ["proctoring", policy.proctoring]] as const) {
    if (adapter.required && (!adapter.providerKey || !available.has(adapter.providerKey))) {
      blockers.push(`${kind.toUpperCase()}_ADAPTER_UNAVAILABLE`);
    }
  }
  return { ready: blockers.length === 0, blockers };
}

export function newLearningTestDeliverySeed() {
  return crypto.randomBytes(24).toString("hex");
}
