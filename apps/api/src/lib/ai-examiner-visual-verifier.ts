export const AI_EXAMINER_VISUAL_OBSERVATION_STATUSES = ["PRESENT", "ABSENT", "UNCLEAR"] as const;
export type AIExaminerVisualObservationStatus = typeof AI_EXAMINER_VISUAL_OBSERVATION_STATUSES[number];

export type AIExaminerVisualValidationConfig = {
  requiredObservations: Array<{
    key: string;
    description: string;
    weight: number;
    required: boolean;
  }>;
  minimumObservationConfidence: number;
};

export type AIExaminerVisualObservation = {
  key: string;
  status: AIExaminerVisualObservationStatus;
  confidence: number;
  evidence?: string | null;
};

export type AIExaminerVisualVerification = {
  engine: "MULTIMODAL";
  reviewRequired: true;
  coverageRate: number;
  verifiedWeight: number;
  totalWeight: number;
  checks: Array<{
    criterion: string;
    status: "PASS" | "FAIL" | "REVIEW";
    rationale: string;
    expected?: unknown;
    observed?: unknown;
  }>;
};

function normalizedKey(value: string) {
  return value.trim().toLocaleLowerCase("en");
}

export function verifyAIExaminerVisualEvidence(input: {
  config: AIExaminerVisualValidationConfig;
  observations?: AIExaminerVisualObservation[] | null;
}): AIExaminerVisualVerification {
  const threshold = input.config.minimumObservationConfidence;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("Visual observation confidence threshold must be between 0 and 1");
  }
  if (!input.config.requiredObservations.length) {
    throw new Error("Visual validation requires at least one configured observation");
  }

  const expectedKeys = new Set<string>();
  for (const expected of input.config.requiredObservations) {
    const key = normalizedKey(expected.key);
    if (!key || expectedKeys.has(key)) throw new Error("Visual validation observation keys must be non-empty and unique");
    if (!Number.isFinite(expected.weight) || expected.weight <= 0) throw new Error("Visual validation observation weights must be positive");
    expectedKeys.add(key);
  }

  const observations = new Map<string, AIExaminerVisualObservation>();
  for (const observed of input.observations ?? []) {
    const key = normalizedKey(observed.key);
    if (!key || observations.has(key)) continue;
    observations.set(key, observed);
  }

  let verifiedWeight = 0;
  let totalWeight = 0;
  const checks: AIExaminerVisualVerification["checks"] = [];

  for (const expected of input.config.requiredObservations) {
    const observed = observations.get(normalizedKey(expected.key));
    if (expected.required) totalWeight += expected.weight;

    if (!observed) {
      checks.push({
        criterion: expected.description,
        status: expected.required ? "REVIEW" : "PASS",
        rationale: expected.required
          ? "The provider returned no structured visual observation for this required criterion."
          : "Optional visual criterion was not observed.",
        expected: { key: expected.key, required: expected.required },
      });
      continue;
    }

    if (!Number.isFinite(observed.confidence) || observed.confidence < 0 || observed.confidence > 1) {
      checks.push({
        criterion: expected.description,
        status: "REVIEW",
        rationale: "The provider returned an invalid observation confidence.",
        observed: { status: observed.status, confidence: observed.confidence },
      });
      continue;
    }

    if (observed.status === "ABSENT") {
      checks.push({
        criterion: expected.description,
        status: expected.required ? "FAIL" : "PASS",
        rationale: expected.required
          ? "The configured required visual element was reported absent."
          : "The optional visual element was reported absent.",
        observed: { status: observed.status, confidence: observed.confidence, evidence: observed.evidence ?? null },
      });
      continue;
    }

    if (observed.status === "UNCLEAR" || observed.confidence < threshold) {
      checks.push({
        criterion: expected.description,
        status: "REVIEW",
        rationale: observed.status === "UNCLEAR"
          ? "The visual element is present but unclear and requires teacher verification."
          : "The visual observation confidence is below the configured threshold.",
        expected: { minimumConfidence: threshold },
        observed: { status: observed.status, confidence: observed.confidence, evidence: observed.evidence ?? null },
      });
      continue;
    }

    if (expected.required) verifiedWeight += expected.weight;
    checks.push({
      criterion: expected.description,
      status: "PASS",
      rationale: "The provider reported the configured visual element as present with sufficient confidence.",
      observed: { status: observed.status, confidence: observed.confidence, evidence: observed.evidence ?? null },
    });
  }

  const coverageRate = totalWeight > 0 ? Math.max(0, Math.min(1, verifiedWeight / totalWeight)) : 1;
  return {
    engine: "MULTIMODAL",
    reviewRequired: true,
    coverageRate: Math.round(coverageRate * 1_000_000) / 1_000_000,
    verifiedWeight: Math.round(verifiedWeight * 10_000) / 10_000,
    totalWeight: Math.round(totalWeight * 10_000) / 10_000,
    checks,
  };
}
