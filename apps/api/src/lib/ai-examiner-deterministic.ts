import type { AIExaminerQuestionType } from "./ai-examiner-assessment-router.js";

export type AIExaminerPartialMode =
  | "NONE"
  | "PROPORTIONAL_NO_WRONG"
  | "PROPORTIONAL_WITH_PENALTY";

export type AIExaminerDeterministicScoringRule = {
  correctMarks?: number;
  incorrectMarks?: number;
  unansweredMarks?: number;
  partialMode?: AIExaminerPartialMode;
  caseSensitive?: boolean;
  trimWhitespace?: boolean;
  numericalTolerance?: {
    absolute?: number;
    relative?: number;
  };
};

export type AIExaminerDeterministicInput = {
  questionKey: string;
  questionType: Extract<
    AIExaminerQuestionType,
    "MCQ" | "MSQ" | "TRUE_FALSE" | "ASSERTION_REASON" | "FILL_BLANK" | "MATCHING" | "ONE_WORD" | "NUMERICAL"
  >;
  maxMarks: number;
  correctAnswer: unknown;
  studentAnswer: unknown;
  scoring?: AIExaminerDeterministicScoringRule;
};

export type AIExaminerDeterministicStatus = "CORRECT" | "PARTIAL" | "INCORRECT" | "UNANSWERED";

export type AIExaminerDeterministicResult = {
  questionKey: string;
  status: AIExaminerDeterministicStatus;
  awardedMarks: number;
  maxMarks: number;
  confidence: 1;
  engine: "DETERMINISTIC_OBJECTIVE" | "DETERMINISTIC_NUMERIC";
  reviewRequired: false;
  evidence: {
    rule: string;
    expected: unknown;
    observed: unknown;
  };
};

export class AIExaminerScoringError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AIExaminerScoringError";
  }
}

function finite(value: number, label: string) {
  if (!Number.isFinite(value)) throw new AIExaminerScoringError("AI_EXAMINER_SCORING_RULE_INVALID", `${label} must be finite`);
  return value;
}

function resolvedRule(input: AIExaminerDeterministicInput) {
  const correctMarks = finite(input.scoring?.correctMarks ?? input.maxMarks, "correctMarks");
  const incorrectMarks = finite(input.scoring?.incorrectMarks ?? 0, "incorrectMarks");
  const unansweredMarks = finite(input.scoring?.unansweredMarks ?? 0, "unansweredMarks");
  if (!Number.isFinite(input.maxMarks) || input.maxMarks <= 0) {
    throw new AIExaminerScoringError("AI_EXAMINER_MAX_MARKS_INVALID", "maxMarks must be a positive finite number");
  }
  if (correctMarks > input.maxMarks) {
    throw new AIExaminerScoringError("AI_EXAMINER_SCORING_RULE_INVALID", "correctMarks cannot exceed maxMarks");
  }
  const absolute = input.scoring?.numericalTolerance?.absolute ?? 0;
  const relative = input.scoring?.numericalTolerance?.relative ?? 0;
  if (!Number.isFinite(absolute) || absolute < 0 || !Number.isFinite(relative) || relative < 0) {
    throw new AIExaminerScoringError("AI_EXAMINER_TOLERANCE_INVALID", "Numerical tolerances must be finite and non-negative");
  }
  return {
    correctMarks,
    incorrectMarks,
    unansweredMarks,
    partialMode: input.scoring?.partialMode ?? "NONE" as AIExaminerPartialMode,
    caseSensitive: input.scoring?.caseSensitive ?? false,
    trimWhitespace: input.scoring?.trimWhitespace ?? true,
    numericalTolerance: { absolute, relative },
  };
}

function blank(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length === 0;
  return false;
}

function normalizeScalar(value: unknown, rule: ReturnType<typeof resolvedRule>) {
  let normalized = String(value ?? "");
  if (rule.trimWhitespace) normalized = normalized.trim().replace(/\s+/g, " ");
  if (!rule.caseSensitive) normalized = normalized.toLocaleLowerCase("en");
  return normalized;
}

function scalarEquals(expected: unknown, observed: unknown, rule: ReturnType<typeof resolvedRule>) {
  return normalizeScalar(expected, rule) === normalizeScalar(observed, rule);
}

function score(
  input: AIExaminerDeterministicInput,
  status: AIExaminerDeterministicStatus,
  awardedMarks: number,
  ruleText: string,
  expected: unknown,
  observed: unknown,
): AIExaminerDeterministicResult {
  return {
    questionKey: input.questionKey,
    status,
    awardedMarks: Math.round(awardedMarks * 10000) / 10000,
    maxMarks: input.maxMarks,
    confidence: 1,
    engine: input.questionType === "NUMERICAL" ? "DETERMINISTIC_NUMERIC" : "DETERMINISTIC_OBJECTIVE",
    reviewRequired: false,
    evidence: { rule: ruleText, expected, observed },
  };
}

function requireArray(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new AIExaminerScoringError("AI_EXAMINER_ANSWER_KEY_INVALID", `${label} must be an array`);
  return value;
}

function requireRecord(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AIExaminerScoringError("AI_EXAMINER_ANSWER_KEY_INVALID", `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function uniqueNormalized(values: unknown[], rule: ReturnType<typeof resolvedRule>) {
  return new Set(values.map(value => normalizeScalar(value, rule)));
}

function scoreSet(input: AIExaminerDeterministicInput, rule: ReturnType<typeof resolvedRule>) {
  const expectedValues = requireArray(input.correctAnswer, "MSQ correctAnswer");
  const observedValues = requireArray(input.studentAnswer, "MSQ studentAnswer");
  const expected = uniqueNormalized(expectedValues, rule);
  const observed = uniqueNormalized(observedValues, rule);
  if (!expected.size) throw new AIExaminerScoringError("AI_EXAMINER_ANSWER_KEY_INVALID", "MSQ answer key cannot be empty");

  const wrong = [...observed].filter(value => !expected.has(value));
  const correctSelected = [...observed].filter(value => expected.has(value)).length;
  const exact = wrong.length === 0 && correctSelected === expected.size && observed.size === expected.size;

  if (exact) return score(input, "CORRECT", rule.correctMarks, "Exact option-set match", [...expected], [...observed]);
  if (rule.partialMode === "NONE") {
    return score(input, "INCORRECT", rule.incorrectMarks, "All-or-nothing option-set scoring", [...expected], [...observed]);
  }
  if (rule.partialMode === "PROPORTIONAL_NO_WRONG") {
    if (wrong.length) {
      return score(input, "INCORRECT", rule.incorrectMarks, "Partial credit is allowed only when no incorrect option is selected", [...expected], [...observed]);
    }
    const fraction = correctSelected / expected.size;
    if (fraction > 0) {
      return score(input, "PARTIAL", rule.correctMarks * fraction, "Proportional credit for correct selected options with no wrong option", [...expected], [...observed]);
    }
    return score(input, "INCORRECT", rule.incorrectMarks, "No correct option selected", [...expected], [...observed]);
  }

  const net = Math.max(0, correctSelected - wrong.length);
  const fraction = Math.min(1, net / expected.size);
  if (fraction > 0) {
    return score(input, "PARTIAL", rule.correctMarks * fraction, "Proportional option credit after wrong-selection penalty", [...expected], [...observed]);
  }
  return score(input, "INCORRECT", rule.incorrectMarks, "Wrong selections removed all partial credit", [...expected], [...observed]);
}

function scoreAliases(input: AIExaminerDeterministicInput, rule: ReturnType<typeof resolvedRule>) {
  const accepted = Array.isArray(input.correctAnswer) ? input.correctAnswer : [input.correctAnswer];
  if (!accepted.length) throw new AIExaminerScoringError("AI_EXAMINER_ANSWER_KEY_INVALID", "Accepted-answer list cannot be empty");
  const match = accepted.some(value => scalarEquals(value, input.studentAnswer, rule));
  return match
    ? score(input, "CORRECT", rule.correctMarks, "Accepted normalized answer", accepted, normalizeScalar(input.studentAnswer, rule))
    : score(input, "INCORRECT", rule.incorrectMarks, "Response did not match any accepted normalized answer", accepted, normalizeScalar(input.studentAnswer, rule));
}

function scoreMatching(input: AIExaminerDeterministicInput, rule: ReturnType<typeof resolvedRule>) {
  const expectedRaw = requireRecord(input.correctAnswer, "MATCHING correctAnswer");
  const observedRaw = requireRecord(input.studentAnswer, "MATCHING studentAnswer");
  const keys = Object.keys(expectedRaw);
  if (!keys.length) throw new AIExaminerScoringError("AI_EXAMINER_ANSWER_KEY_INVALID", "Matching answer key cannot be empty");

  let matches = 0;
  for (const key of keys) {
    if (key in observedRaw && scalarEquals(expectedRaw[key], observedRaw[key], rule)) matches++;
  }
  if (matches === keys.length && Object.keys(observedRaw).length === keys.length) {
    return score(input, "CORRECT", rule.correctMarks, "All matching pairs are correct", expectedRaw, observedRaw);
  }
  if (rule.partialMode === "NONE") {
    return score(input, "INCORRECT", rule.incorrectMarks, "All-or-nothing matching scoring", expectedRaw, observedRaw);
  }
  if (matches > 0) {
    return score(input, "PARTIAL", rule.correctMarks * (matches / keys.length), "Proportional credit for correct matching pairs", expectedRaw, observedRaw);
  }
  return score(input, "INCORRECT", rule.incorrectMarks, "No matching pair is correct", expectedRaw, observedRaw);
}

function scoreNumerical(input: AIExaminerDeterministicInput, rule: ReturnType<typeof resolvedRule>) {
  const expected = typeof input.correctAnswer === "number" ? input.correctAnswer : Number(String(input.correctAnswer).trim());
  const observed = typeof input.studentAnswer === "number" ? input.studentAnswer : Number(String(input.studentAnswer).trim());
  if (!Number.isFinite(expected)) throw new AIExaminerScoringError("AI_EXAMINER_ANSWER_KEY_INVALID", "Numerical answer key must be numeric");
  if (!Number.isFinite(observed)) {
    return score(input, "INCORRECT", rule.incorrectMarks, "Student response is not a valid number", expected, input.studentAnswer);
  }
  const difference = Math.abs(observed - expected);
  const allowed = Math.max(rule.numericalTolerance.absolute, Math.abs(expected) * rule.numericalTolerance.relative);
  const match = difference <= allowed;
  return match
    ? score(input, "CORRECT", rule.correctMarks, `Numerical difference ${difference} is within tolerance ${allowed}`, expected, observed)
    : score(input, "INCORRECT", rule.incorrectMarks, `Numerical difference ${difference} exceeds tolerance ${allowed}`, expected, observed);
}

export function scoreDeterministicQuestion(input: AIExaminerDeterministicInput): AIExaminerDeterministicResult {
  const rule = resolvedRule(input);
  if (blank(input.studentAnswer)) {
    return score(input, "UNANSWERED", rule.unansweredMarks, "No response supplied", input.correctAnswer, input.studentAnswer);
  }

  switch (input.questionType) {
    case "MSQ":
      return scoreSet(input, rule);
    case "FILL_BLANK":
    case "ONE_WORD":
      return scoreAliases(input, rule);
    case "MATCHING":
      return scoreMatching(input, rule);
    case "NUMERICAL":
      return scoreNumerical(input, rule);
    case "MCQ":
    case "TRUE_FALSE":
    case "ASSERTION_REASON": {
      const match = scalarEquals(input.correctAnswer, input.studentAnswer, rule);
      return match
        ? score(input, "CORRECT", rule.correctMarks, "Exact normalized answer-key match", normalizeScalar(input.correctAnswer, rule), normalizeScalar(input.studentAnswer, rule))
        : score(input, "INCORRECT", rule.incorrectMarks, "Response does not match the configured answer key", normalizeScalar(input.correctAnswer, rule), normalizeScalar(input.studentAnswer, rule));
    }
  }
}
