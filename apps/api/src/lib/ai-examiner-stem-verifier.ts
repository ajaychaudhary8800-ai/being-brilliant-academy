export type AIExaminerStemCheckStatus = "PASS" | "FAIL" | "REVIEW";

export type AIExaminerStemValidationConfig = {
  expectedExpression?: string;
  expectedNumericValue?: number;
  numericalTolerance?: { absolute?: number; relative?: number };
  expectedUnit?: string;
  acceptedUnits?: string[];
  unitRequired?: boolean;
  expectedSign?: "POSITIVE" | "NEGATIVE" | "ZERO" | "NONZERO" | "ANY";
  significantFigures?: {
    count: number;
    mode?: "EXACT" | "AT_LEAST";
  };
  stepCriteria?: Array<{
    key: string;
    marks: number;
    evidence: string[];
  }>;
};

export type AIExaminerStemCheck = {
  criterion: string;
  status: AIExaminerStemCheckStatus;
  rationale: string;
  expected?: unknown;
  observed?: unknown;
};

export type AIExaminerStemVerification = {
  checks: AIExaminerStemCheck[];
  reviewRequired: true;
  deterministicEvidenceMarks: number;
  deterministicEvidenceMaxMarks: number;
  normalizedResponse: string;
};

type ParsedQuantity = {
  numericText: string | null;
  value: number | null;
  unit: string | null;
};

function normalizedText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[−–—]/g, "-")
    .replace(/[×·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/\s+/g, "")
    .trim();
}

function normalizeUnit(value: string) {
  return normalizedText(value)
    .replace(/\^\+/g, "^")
    .replace(/\*+/g, "*");
}

function parseQuantity(response: string): ParsedQuantity {
  const trimmed = response.trim();
  const match = trimmed.match(/^([+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?)(?:\s*)(.*)$/);
  if (!match) return { numericText: null, value: null, unit: null };
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return { numericText: match[1], value: null, unit: match[2]?.trim() || null };
  return { numericText: match[1], value, unit: match[2]?.trim() || null };
}

function tolerance(expected: number, config?: AIExaminerStemValidationConfig["numericalTolerance"]) {
  const absolute = config?.absolute ?? 0;
  const relative = config?.relative ?? 0;
  return Math.max(absolute, Math.abs(expected) * relative);
}

function significantFigureInfo(text: string): { count: number | null; ambiguous: boolean } {
  const raw = text.trim().toLowerCase();
  if (!raw) return { count: null, ambiguous: true };
  const mantissa = raw.split("e")[0].replace(/^[+-]/, "");
  if (!/^\d*\.?\d+$/.test(mantissa)) return { count: null, ambiguous: true };

  const decimal = mantissa.includes(".");
  const digits = mantissa.replace(".", "");
  const firstNonZero = digits.search(/[1-9]/);
  if (firstNonZero < 0) {
    if (decimal) {
      const fractional = mantissa.split(".")[1] ?? "";
      return { count: Math.max(1, fractional.length), ambiguous: false };
    }
    return { count: 1, ambiguous: true };
  }

  let significant = digits.slice(firstNonZero);
  if (!decimal && !raw.includes("e") && /0$/.test(significant)) {
    return { count: significant.replace(/0+$/, "").length || 1, ambiguous: true };
  }
  return { count: significant.length, ambiguous: false };
}

function exactExpressionMatch(expected: string, observed: string) {
  return normalizedText(expected) === normalizedText(observed);
}

function evidenceMatch(response: string, evidence: string) {
  const haystack = normalizedText(response).toLocaleLowerCase("en");
  const needle = normalizedText(evidence).toLocaleLowerCase("en");
  return Boolean(needle) && haystack.includes(needle);
}

export function verifyAIExaminerStemResponse(input: {
  response: string;
  config: AIExaminerStemValidationConfig;
}): AIExaminerStemVerification {
  const checks: AIExaminerStemCheck[] = [];
  const parsed = parseQuantity(input.response);
  const normalizedResponse = normalizedText(input.response);

  if (input.config.expectedNumericValue != null) {
    if (parsed.value == null) {
      checks.push({
        criterion: "Numerical value",
        status: "REVIEW",
        rationale: "A numeric value could not be safely extracted from the response.",
        expected: input.config.expectedNumericValue,
        observed: input.response,
      });
    } else {
      const allowed = tolerance(input.config.expectedNumericValue, input.config.numericalTolerance);
      const difference = Math.abs(parsed.value - input.config.expectedNumericValue);
      checks.push({
        criterion: "Numerical value",
        status: difference <= allowed ? "PASS" : "FAIL",
        rationale: difference <= allowed
          ? `Absolute difference ${difference} is within configured tolerance ${allowed}.`
          : `Absolute difference ${difference} exceeds configured tolerance ${allowed}.`,
        expected: input.config.expectedNumericValue,
        observed: parsed.value,
      });
    }
  }

  if (input.config.expectedExpression) {
    if (exactExpressionMatch(input.config.expectedExpression, input.response)) {
      checks.push({
        criterion: "Symbolic expression",
        status: "PASS",
        rationale: "The normalized symbolic response exactly matches the configured reference expression.",
        expected: input.config.expectedExpression,
        observed: input.response,
      });
    } else {
      checks.push({
        criterion: "Symbolic expression",
        status: "REVIEW",
        rationale: "Non-identical symbolic forms require a subject-specific equivalence engine or human verification; no incorrect verdict was inferred.",
        expected: input.config.expectedExpression,
        observed: input.response,
      });
    }
  }

  if (input.config.expectedUnit) {
    const unitRequired = input.config.unitRequired ?? true;
    if (!parsed.unit) {
      checks.push({
        criterion: "Unit",
        status: unitRequired ? "FAIL" : "REVIEW",
        rationale: unitRequired ? "A required unit was not present." : "No unit was present; manual review may be needed.",
        expected: input.config.expectedUnit,
        observed: null,
      });
    } else {
      const accepted = new Set(
        [input.config.expectedUnit, ...(input.config.acceptedUnits ?? [])].map(normalizeUnit),
      );
      const normalizedObserved = normalizeUnit(parsed.unit);
      checks.push({
        criterion: "Unit",
        status: accepted.has(normalizedObserved) ? "PASS" : "FAIL",
        rationale: accepted.has(normalizedObserved)
          ? "The submitted unit matches an explicitly accepted unit representation."
          : "The submitted unit does not match any explicitly accepted unit representation; no unconfigured conversion was assumed.",
        expected: [...accepted],
        observed: normalizedObserved,
      });
    }
  }

  if (input.config.expectedSign && input.config.expectedSign !== "ANY") {
    if (parsed.value == null) {
      checks.push({
        criterion: "Sign",
        status: "REVIEW",
        rationale: "The sign could not be checked because a numeric value was not safely extracted.",
        expected: input.config.expectedSign,
        observed: input.response,
      });
    } else {
      const pass =
        input.config.expectedSign === "POSITIVE" ? parsed.value > 0 :
        input.config.expectedSign === "NEGATIVE" ? parsed.value < 0 :
        input.config.expectedSign === "ZERO" ? Object.is(parsed.value, 0) || parsed.value === 0 :
        parsed.value !== 0;
      checks.push({
        criterion: "Sign",
        status: pass ? "PASS" : "FAIL",
        rationale: pass ? "The numerical sign satisfies the configured requirement." : "The numerical sign violates the configured requirement.",
        expected: input.config.expectedSign,
        observed: parsed.value,
      });
    }
  }

  if (input.config.significantFigures) {
    if (!parsed.numericText) {
      checks.push({
        criterion: "Significant figures",
        status: "REVIEW",
        rationale: "Significant figures could not be counted because a numeric token was not safely extracted.",
        expected: input.config.significantFigures,
        observed: input.response,
      });
    } else {
      const info = significantFigureInfo(parsed.numericText);
      if (info.count == null || info.ambiguous) {
        checks.push({
          criterion: "Significant figures",
          status: "REVIEW",
          rationale: "The written number has ambiguous significant-figure intent and requires review.",
          expected: input.config.significantFigures,
          observed: { token: parsed.numericText, count: info.count, ambiguous: info.ambiguous },
        });
      } else {
        const mode = input.config.significantFigures.mode ?? "EXACT";
        const pass = mode === "EXACT"
          ? info.count === input.config.significantFigures.count
          : info.count >= input.config.significantFigures.count;
        checks.push({
          criterion: "Significant figures",
          status: pass ? "PASS" : "FAIL",
          rationale: pass
            ? `The response has ${info.count} significant figures, satisfying the configured ${mode.toLowerCase()} rule.`
            : `The response has ${info.count} significant figures and does not satisfy the configured ${mode.toLowerCase()} rule.`,
          expected: input.config.significantFigures,
          observed: info.count,
        });
      }
    }
  }

  let deterministicEvidenceMarks = 0;
  let deterministicEvidenceMaxMarks = 0;
  for (const step of input.config.stepCriteria ?? []) {
    deterministicEvidenceMaxMarks += step.marks;
    const found = step.evidence.some(item => evidenceMatch(input.response, item));
    if (found) deterministicEvidenceMarks += step.marks;
    checks.push({
      criterion: `Step: ${step.key}`,
      status: found ? "PASS" : "REVIEW",
      rationale: found
        ? "Explicit configured evidence for this step was found in the extracted response."
        : "Configured literal evidence was not found; semantic equivalence must be reviewed rather than treated as an automatic deduction.",
      expected: step.evidence,
      observed: found ? "evidence-found" : "not-deterministically-found",
    });
  }

  return {
    checks,
    reviewRequired: true,
    deterministicEvidenceMarks: Math.round(deterministicEvidenceMarks * 10000) / 10000,
    deterministicEvidenceMaxMarks: Math.round(deterministicEvidenceMaxMarks * 10000) / 10000,
    normalizedResponse,
  };
}

export const aiExaminerStemInternals = {
  normalizedText,
  normalizeUnit,
  parseQuantity,
  significantFigureInfo,
};
