import assert from "node:assert/strict";
import test from "node:test";
import { verifyAIExaminerVisualEvidence } from "./ai-examiner-visual-verifier.js";

const config = {
  minimumObservationConfidence: 0.8,
  requiredObservations: [
    { key: "axes", description: "Both graph axes are drawn and labelled", weight: 2, required: true },
    { key: "scale", description: "A consistent scale is used", weight: 1, required: true },
    { key: "legend", description: "Legend is present", weight: 1, required: false },
  ],
};

test("structured multimodal evidence verifies configured required elements but remains human reviewed", () => {
  const result = verifyAIExaminerVisualEvidence({
    config,
    observations: [
      { key: "axes", status: "PRESENT", confidence: 0.95, evidence: "x-axis: time; y-axis: velocity" },
      { key: "scale", status: "PRESENT", confidence: 0.9, evidence: "equal 2-unit intervals" },
    ],
  });

  assert.equal(result.engine, "MULTIMODAL");
  assert.equal(result.reviewRequired, true);
  assert.equal(result.coverageRate, 1);
  assert.equal(result.verifiedWeight, 3);
  assert.equal(result.totalWeight, 3);
});

test("missing, absent, unclear and low-confidence required visual evidence cannot be treated as verified", () => {
  const result = verifyAIExaminerVisualEvidence({
    config,
    observations: [
      { key: "axes", status: "ABSENT", confidence: 0.99 },
      { key: "scale", status: "UNCLEAR", confidence: 0.9 },
    ],
  });

  assert.equal(result.coverageRate, 0);
  assert.equal(result.checks.find(row => row.criterion.includes("axes"))?.status, "FAIL");
  assert.equal(result.checks.find(row => row.criterion.includes("scale"))?.status, "REVIEW");
});

test("low confidence routes visual observations to review", () => {
  const result = verifyAIExaminerVisualEvidence({
    config,
    observations: [
      { key: "axes", status: "PRESENT", confidence: 0.79 },
      { key: "scale", status: "PRESENT", confidence: 0.95 },
    ],
  });
  assert.equal(result.coverageRate, 0.333333);
  assert.equal(result.checks[0]?.status, "REVIEW");
});

test("invalid visual validation configuration fails closed", () => {
  assert.throws(() => verifyAIExaminerVisualEvidence({
    config: {
      minimumObservationConfidence: 1.1,
      requiredObservations: [{ key: "x", description: "x", weight: 1, required: true }],
    },
    observations: [],
  }));
  assert.throws(() => verifyAIExaminerVisualEvidence({
    config: {
      minimumObservationConfidence: 0.8,
      requiredObservations: [
        { key: "same", description: "a", weight: 1, required: true },
        { key: "SAME", description: "b", weight: 1, required: true },
      ],
    },
    observations: [],
  }));
});
