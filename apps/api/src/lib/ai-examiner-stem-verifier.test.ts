import assert from "node:assert/strict";
import test from "node:test";
import { aiExaminerStemInternals, verifyAIExaminerStemResponse } from "./ai-examiner-stem-verifier.js";

test("STEM verifier checks numerical tolerance, units, sign and significant figures conservatively", () => {
  const result = verifyAIExaminerStemResponse({
    response: "-9.81 m/s^2",
    config: {
      expectedNumericValue: -9.8,
      numericalTolerance: { absolute: 0.02 },
      expectedUnit: "m/s^2",
      acceptedUnits: ["m s^-2"],
      expectedSign: "NEGATIVE",
      significantFigures: { count: 3, mode: "EXACT" },
    },
  });

  assert.equal(result.reviewRequired, true);
  assert.deepEqual(result.checks.map(row => row.status), ["PASS", "PASS", "PASS", "PASS"]);
});

test("STEM verifier never calls a non-identical symbolic form incorrect without an equivalence engine", () => {
  const result = verifyAIExaminerStemResponse({
    response: "2*x",
    config: { expectedExpression: "x+x" },
  });
  assert.equal(result.checks[0].criterion, "Symbolic expression");
  assert.equal(result.checks[0].status, "REVIEW");
  assert.match(result.checks[0].rationale, /no incorrect verdict was inferred/i);
});

test("STEM verifier recognizes exact normalized symbolic forms", () => {
  const result = verifyAIExaminerStemResponse({
    response: " F = m × a ",
    config: { expectedExpression: "F=m*a" },
  });
  assert.equal(result.checks[0].status, "PASS");
});

test("unit checking accepts only configured representations and does not invent conversions", () => {
  const accepted = verifyAIExaminerStemResponse({
    response: "100 cm",
    config: { expectedNumericValue: 100, expectedUnit: "cm", acceptedUnits: ["centimeter"] },
  });
  assert.equal(accepted.checks.find(row => row.criterion === "Unit")?.status, "PASS");

  const unconfiguredConversion = verifyAIExaminerStemResponse({
    response: "1 m",
    config: { expectedNumericValue: 100, expectedUnit: "cm" },
  });
  assert.equal(unconfiguredConversion.checks.find(row => row.criterion === "Numerical value")?.status, "FAIL");
  assert.equal(unconfiguredConversion.checks.find(row => row.criterion === "Unit")?.status, "FAIL");
});

test("step evidence can contribute deterministic partial evidence without auto-deducting missing semantic equivalents", () => {
  const result = verifyAIExaminerStemResponse({
    response: "Using v = u + at, therefore v = 10 m/s.",
    config: {
      stepCriteria: [
        { key: "kinematic-equation", marks: 1, evidence: ["v=u+at"] },
        { key: "substitution", marks: 1, evidence: ["u=0"] },
      ],
    },
  });
  assert.equal(result.deterministicEvidenceMarks, 1);
  assert.equal(result.deterministicEvidenceMaxMarks, 2);
  assert.equal(result.checks[0].status, "PASS");
  assert.equal(result.checks[1].status, "REVIEW");
});

test("integer trailing zeros are treated as significant-figure ambiguous", () => {
  const info = aiExaminerStemInternals.significantFigureInfo("1500");
  assert.equal(info.ambiguous, true);

  const result = verifyAIExaminerStemResponse({
    response: "1500",
    config: { significantFigures: { count: 4 } },
  });
  assert.equal(result.checks[0].status, "REVIEW");
});
