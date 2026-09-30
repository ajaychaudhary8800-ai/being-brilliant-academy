export type AIExaminerBenchmarkCase = {
  id: string;
  humanMarks: number;
  aiMarks: number;
  maxMarks: number;
  minimumMarks?: number;
  confidence: number;
  reviewRequired?: boolean;
  teacherOverride?: boolean;
  subjectKey?: string;
  questionType?: string;
};

export type AIExaminerBenchmarkThresholds = {
  minimumCases: number;
  agreementToleranceMarks?: number;
  agreementToleranceRatio?: number;
  maximumNormalizedMae: number;
  minimumWithinToleranceRate: number;
  maximumOverrideRate: number;
  maximumLowConfidenceRate: number;
  lowConfidenceThreshold: number;
};

export type AIExaminerBenchmarkMetrics = {
  caseCount: number;
  meanAbsoluteErrorMarks: number;
  normalizedMae: number;
  meanSignedErrorMarks: number;
  withinToleranceRate: number;
  exactAgreementRate: number;
  overrideRate: number;
  lowConfidenceRate: number;
  reviewRequiredRate: number;
};

export type AIExaminerBenchmarkGate = {
  ready: boolean;
  metrics: AIExaminerBenchmarkMetrics;
  failures: string[];
};

export type AIExaminerDriftThresholds = {
  maximumNormalizedMaeIncrease: number;
  maximumOverrideRateIncrease: number;
  maximumLowConfidenceRateIncrease: number;
  maximumWithinToleranceRateDrop: number;
};

function finite(value: number, label: string) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function validCase(row: AIExaminerBenchmarkCase) {
  finite(row.humanMarks, "humanMarks");
  finite(row.aiMarks, "aiMarks");
  finite(row.maxMarks, "maxMarks");
  finite(row.confidence, "confidence");
  if (row.maxMarks <= 0) throw new Error("maxMarks must be positive");
  const minimumMarks = row.minimumMarks ?? 0;
  finite(minimumMarks, "minimumMarks");
  if (minimumMarks > row.maxMarks) throw new Error("minimumMarks cannot exceed maxMarks");
  if (row.confidence < 0 || row.confidence > 1) throw new Error("confidence must be between 0 and 1");
  if (row.humanMarks < minimumMarks || row.humanMarks > row.maxMarks) throw new Error("humanMarks must be within question bounds");
  if (row.aiMarks < minimumMarks || row.aiMarks > row.maxMarks) throw new Error("aiMarks must be within question bounds");
  return row;
}

function round(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function toleranceFor(row: AIExaminerBenchmarkCase, thresholds: AIExaminerBenchmarkThresholds) {
  return Math.max(
    thresholds.agreementToleranceMarks ?? 0,
    row.maxMarks * (thresholds.agreementToleranceRatio ?? 0),
  );
}

export function calculateAIExaminerBenchmarkMetrics(
  rows: AIExaminerBenchmarkCase[],
  thresholds: Pick<
    AIExaminerBenchmarkThresholds,
    "agreementToleranceMarks" | "agreementToleranceRatio" | "lowConfidenceThreshold"
  >,
): AIExaminerBenchmarkMetrics {
  if (!rows.length) {
    return {
      caseCount: 0,
      meanAbsoluteErrorMarks: 0,
      normalizedMae: 0,
      meanSignedErrorMarks: 0,
      withinToleranceRate: 0,
      exactAgreementRate: 0,
      overrideRate: 0,
      lowConfidenceRate: 0,
      reviewRequiredRate: 0,
    };
  }

  let absoluteError = 0;
  let normalizedAbsoluteError = 0;
  let signedError = 0;
  let withinTolerance = 0;
  let exactAgreement = 0;
  let overrides = 0;
  let lowConfidence = 0;
  let reviewRequired = 0;

  for (const source of rows) {
    const row = validCase(source);
    const error = row.aiMarks - row.humanMarks;
    const absolute = Math.abs(error);
    absoluteError += absolute;
    normalizedAbsoluteError += absolute / row.maxMarks;
    signedError += error;
    const tolerance = Math.max(
      thresholds.agreementToleranceMarks ?? 0,
      row.maxMarks * (thresholds.agreementToleranceRatio ?? 0),
    );
    if (absolute <= tolerance) withinTolerance++;
    if (absolute <= 0.000001) exactAgreement++;
    if (row.teacherOverride) overrides++;
    if (row.confidence < thresholds.lowConfidenceThreshold) lowConfidence++;
    if (row.reviewRequired) reviewRequired++;
  }

  return {
    caseCount: rows.length,
    meanAbsoluteErrorMarks: round(absoluteError / rows.length),
    normalizedMae: round(normalizedAbsoluteError / rows.length),
    meanSignedErrorMarks: round(signedError / rows.length),
    withinToleranceRate: round(withinTolerance / rows.length),
    exactAgreementRate: round(exactAgreement / rows.length),
    overrideRate: round(overrides / rows.length),
    lowConfidenceRate: round(lowConfidence / rows.length),
    reviewRequiredRate: round(reviewRequired / rows.length),
  };
}

export function evaluateAIExaminerBenchmarkGate(
  rows: AIExaminerBenchmarkCase[],
  thresholds: AIExaminerBenchmarkThresholds,
): AIExaminerBenchmarkGate {
  if (!Number.isInteger(thresholds.minimumCases) || thresholds.minimumCases < 1) {
    throw new Error("minimumCases must be a positive integer");
  }
  if (thresholds.lowConfidenceThreshold < 0 || thresholds.lowConfidenceThreshold > 1) {
    throw new Error("lowConfidenceThreshold must be between 0 and 1");
  }

  const metrics = calculateAIExaminerBenchmarkMetrics(rows, thresholds);
  const failures: string[] = [];

  if (metrics.caseCount < thresholds.minimumCases) {
    failures.push(`Need at least ${thresholds.minimumCases} benchmark cases; found ${metrics.caseCount}.`);
  }
  if (metrics.normalizedMae > thresholds.maximumNormalizedMae) {
    failures.push(`Normalized MAE ${metrics.normalizedMae} exceeds ${thresholds.maximumNormalizedMae}.`);
  }
  if (metrics.withinToleranceRate < thresholds.minimumWithinToleranceRate) {
    failures.push(`Within-tolerance rate ${metrics.withinToleranceRate} is below ${thresholds.minimumWithinToleranceRate}.`);
  }
  if (metrics.overrideRate > thresholds.maximumOverrideRate) {
    failures.push(`Teacher override rate ${metrics.overrideRate} exceeds ${thresholds.maximumOverrideRate}.`);
  }
  if (metrics.lowConfidenceRate > thresholds.maximumLowConfidenceRate) {
    failures.push(`Low-confidence rate ${metrics.lowConfidenceRate} exceeds ${thresholds.maximumLowConfidenceRate}.`);
  }

  return { ready: failures.length === 0, metrics, failures };
}

export function groupAIExaminerBenchmarkMetrics(
  rows: AIExaminerBenchmarkCase[],
  dimension: "subjectKey" | "questionType",
  thresholds: Pick<
    AIExaminerBenchmarkThresholds,
    "agreementToleranceMarks" | "agreementToleranceRatio" | "lowConfidenceThreshold"
  >,
) {
  const groups = new Map<string, AIExaminerBenchmarkCase[]>();
  for (const row of rows) {
    const key = row[dimension]?.trim() || "UNSPECIFIED";
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }
  return [...groups.entries()]
    .map(([key, cases]) => ({ key, metrics: calculateAIExaminerBenchmarkMetrics(cases, thresholds) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function assessAIExaminerBenchmarkDrift(
  baseline: AIExaminerBenchmarkMetrics,
  current: AIExaminerBenchmarkMetrics,
  thresholds: AIExaminerDriftThresholds,
) {
  const deltas = {
    normalizedMae: round(current.normalizedMae - baseline.normalizedMae),
    overrideRate: round(current.overrideRate - baseline.overrideRate),
    lowConfidenceRate: round(current.lowConfidenceRate - baseline.lowConfidenceRate),
    withinToleranceRate: round(current.withinToleranceRate - baseline.withinToleranceRate),
  };
  const failures: string[] = [];
  if (deltas.normalizedMae > thresholds.maximumNormalizedMaeIncrease) {
    failures.push("Normalized MAE drift exceeded threshold.");
  }
  if (deltas.overrideRate > thresholds.maximumOverrideRateIncrease) {
    failures.push("Teacher override-rate drift exceeded threshold.");
  }
  if (deltas.lowConfidenceRate > thresholds.maximumLowConfidenceRateIncrease) {
    failures.push("Low-confidence-rate drift exceeded threshold.");
  }
  if (-deltas.withinToleranceRate > thresholds.maximumWithinToleranceRateDrop) {
    failures.push("Within-tolerance agreement dropped beyond threshold.");
  }
  return { driftDetected: failures.length > 0, deltas, failures };
}

export function benchmarkToleranceForCase(
  row: AIExaminerBenchmarkCase,
  thresholds: AIExaminerBenchmarkThresholds,
) {
  validCase(row);
  return toleranceFor(row, thresholds);
}
