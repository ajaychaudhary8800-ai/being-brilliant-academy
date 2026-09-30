import assert from "node:assert/strict";
import test from "node:test";
import {
  assessAIExaminerBenchmarkDrift,
  calculateAIExaminerBenchmarkMetrics,
  evaluateAIExaminerBenchmarkGate,
  groupAIExaminerBenchmarkMetrics,
  type AIExaminerBenchmarkCase,
} from "./ai-examiner-benchmark.js";

const rows: AIExaminerBenchmarkCase[] = [
  { id: "1", humanMarks: 4, aiMarks: 4, maxMarks: 4, confidence: 0.95, subjectKey: "Physics", questionType: "MCQ" },
  { id: "2", humanMarks: 3, aiMarks: 3, maxMarks: 4, confidence: 0.90, subjectKey: "Physics", questionType: "MCQ" },
  { id: "3", humanMarks: 4, aiMarks: 3.5, maxMarks: 5, confidence: 0.82, reviewRequired: true, subjectKey: "Chemistry", questionType: "CHEMISTRY_EQUATION" },
  { id: "4", humanMarks: 2, aiMarks: 1.5, maxMarks: 5, confidence: 0.60, teacherOverride: true, reviewRequired: true, subjectKey: "Chemistry", questionType: "CHEMISTRY_EQUATION" },
];

const thresholds = {
  minimumCases: 4,
  agreementToleranceMarks: 0.5,
  agreementToleranceRatio: 0,
  maximumNormalizedMae: 0.06,
  minimumWithinToleranceRate: 1,
  maximumOverrideRate: 0.3,
  maximumLowConfidenceRate: 0.3,
  lowConfidenceThreshold: 0.7,
};

test("benchmark metrics track agreement, error, override and low-confidence rates", () => {
  const metrics = calculateAIExaminerBenchmarkMetrics(rows, thresholds);
  assert.equal(metrics.caseCount, 4);
  assert.equal(metrics.meanAbsoluteErrorMarks, 0.25);
  assert.equal(metrics.normalizedMae, 0.05);
  assert.equal(metrics.withinToleranceRate, 1);
  assert.equal(metrics.exactAgreementRate, 0.5);
  assert.equal(metrics.overrideRate, 0.25);
  assert.equal(metrics.lowConfidenceRate, 0.25);
  assert.equal(metrics.reviewRequiredRate, 0.5);
});

test("benchmark release gate can pass only when every configured threshold passes", () => {
  const gate = evaluateAIExaminerBenchmarkGate(rows, thresholds);
  assert.equal(gate.ready, true);
  assert.deepEqual(gate.failures, []);

  const strict = evaluateAIExaminerBenchmarkGate(rows, {
    ...thresholds,
    minimumCases: 10,
    maximumOverrideRate: 0.1,
  });
  assert.equal(strict.ready, false);
  assert.ok(strict.failures.some(value => /at least 10 benchmark cases/i.test(value)));
  assert.ok(strict.failures.some(value => /override rate/i.test(value)));
});

test("benchmark metrics group by subject and question type", () => {
  const bySubject = groupAIExaminerBenchmarkMetrics(rows, "subjectKey", thresholds);
  assert.deepEqual(bySubject.map(row => row.key), ["Chemistry", "Physics"]);
  assert.equal(bySubject.find(row => row.key === "Physics")?.metrics.exactAgreementRate, 1);

  const byType = groupAIExaminerBenchmarkMetrics(rows, "questionType", thresholds);
  assert.equal(byType.length, 2);
});

test("drift detection compares current performance against a baseline", () => {
  const baseline = calculateAIExaminerBenchmarkMetrics(rows.slice(0, 2), thresholds);
  const current = calculateAIExaminerBenchmarkMetrics(rows, thresholds);
  const drift = assessAIExaminerBenchmarkDrift(baseline, current, {
    maximumNormalizedMaeIncrease: 0.02,
    maximumOverrideRateIncrease: 0.1,
    maximumLowConfidenceRateIncrease: 0.1,
    maximumWithinToleranceRateDrop: 0.05,
  });
  assert.equal(drift.driftDetected, true);
  assert.ok(drift.failures.length >= 1);
});

test("benchmark cases support configured negative marking floors", () => {
  const gate = evaluateAIExaminerBenchmarkGate([
    { id: "negative", humanMarks: -1, aiMarks: -1, maxMarks: 4, minimumMarks: -1, confidence: 0.98 },
  ], {
    ...thresholds,
    minimumCases: 1,
    maximumNormalizedMae: 0,
    minimumWithinToleranceRate: 1,
    maximumOverrideRate: 0,
    maximumLowConfidenceRate: 0,
  });
  assert.equal(gate.ready, true);
  assert.equal(gate.metrics.exactAgreementRate, 1);
});

test("invalid benchmark marks or confidence fail closed", () => {
  assert.throws(() => calculateAIExaminerBenchmarkMetrics([
    { id: "bad", humanMarks: 6, aiMarks: 2, maxMarks: 5, confidence: 0.9 },
  ], thresholds));
  assert.throws(() => calculateAIExaminerBenchmarkMetrics([
    { id: "bad", humanMarks: 2, aiMarks: 2, maxMarks: 5, confidence: 1.2 },
  ], thresholds));
});


test("evidence-verification metrics can gate multimodal readiness without changing legacy suites", () => {
  const visualRows: AIExaminerBenchmarkCase[] = [
    { id: "v1", humanMarks: 4, aiMarks: 4, maxMarks: 4, confidence: 0.95, questionType: "GRAPH", evidenceVerified: true },
    { id: "v2", humanMarks: 3, aiMarks: 3, maxMarks: 4, confidence: 0.92, questionType: "GRAPH", evidenceVerified: false },
  ];
  const metrics = calculateAIExaminerBenchmarkMetrics(visualRows, thresholds);
  assert.equal(metrics.evidenceCaseCount, 2);
  assert.equal(metrics.evidenceVerificationRate, 0.5);

  const gate = evaluateAIExaminerBenchmarkGate(visualRows, {
    ...thresholds,
    minimumCases: 2,
    maximumNormalizedMae: 0,
    minimumWithinToleranceRate: 1,
    maximumOverrideRate: 0,
    maximumLowConfidenceRate: 0,
    minimumEvidenceVerificationRate: 0.75,
  });
  assert.equal(gate.ready, false);
  assert.ok(gate.failures.some(value => /evidence verification rate/i.test(value)));

  const legacy = evaluateAIExaminerBenchmarkGate(visualRows.map(({ evidenceVerified: _evidenceVerified, ...row }) => row), {
    ...thresholds,
    minimumCases: 2,
    maximumNormalizedMae: 0,
    minimumWithinToleranceRate: 1,
    maximumOverrideRate: 0,
    maximumLowConfidenceRate: 0,
  });
  assert.equal(legacy.ready, true);
});

test("evidence-verification drift can be monitored independently", () => {
  const baseline = {
    ...calculateAIExaminerBenchmarkMetrics(rows, thresholds),
    evidenceCaseCount: 4,
    evidenceVerificationRate: 1,
  };
  const current = { ...baseline, evidenceVerificationRate: 0.6 };
  const drift = assessAIExaminerBenchmarkDrift(baseline, current, {
    maximumNormalizedMaeIncrease: 1,
    maximumOverrideRateIncrease: 1,
    maximumLowConfidenceRateIncrease: 1,
    maximumWithinToleranceRateDrop: 1,
    maximumEvidenceVerificationRateDrop: 0.2,
  });
  assert.equal(drift.driftDetected, true);
  assert.ok(drift.failures.some(value => /evidence-verification rate/i.test(value)));
});
