import assert from "node:assert/strict";
import test from "node:test";
import {
  reconcileAIExaminerProviderResult,
  resolveAIExaminerRubricQuestions,
} from "./ai-examiner-orchestration.js";
import type { AIExaminerProviderResult } from "./ai-examiner-engine.js";

function provider(extractedAnswer: string): AIExaminerProviderResult {
  return {
    extractedText: extractedAnswer,
    overallFeedback: "Teacher review required.",
    confidence: 0.96,
    diagnostics: { weakConcepts: [], strongConcepts: [], qualityFlags: [] },
    questions: [{
      questionKey: "Q1",
      maxMarks: 5,
      awardedMarks: 4,
      confidence: 0.96,
      extractedAnswer,
      feedback: "Structured response extracted.",
      rubricBreakdown: [],
      concepts: [],
      flags: [],
    }],
  };
}

test("calculation rubric can persist supervised STEM validation rules", () => {
  const questions = resolveAIExaminerRubricQuestions({
    questions: [{
      key: "Q1",
      maxMarks: 5,
      criteria: "Calculate acceleration with unit.",
      questionType: "CALCULATION",
      concepts: ["Kinematics"],
      stemValidation: {
        expectedNumericValue: -9.8,
        numericalTolerance: { absolute: 0.05 },
        expectedUnit: "m/s^2",
        expectedSign: "NEGATIVE",
        significantFigures: { count: 2, mode: "AT_LEAST" },
        stepCriteria: [{ key: "equation", marks: 1, evidence: ["v=u+at"] }],
      },
    }],
  }, null);

  assert.equal(questions[0]?.stemValidation?.expectedUnit, "m/s^2");
});

test("specialized calculation reconciliation records STEM evidence but stays human supervised", () => {
  const questions = resolveAIExaminerRubricQuestions({
    questions: [{
      key: "Q1",
      maxMarks: 5,
      criteria: "Calculate acceleration with unit.",
      questionType: "CALCULATION",
      concepts: ["Kinematics"],
      stemValidation: {
        expectedNumericValue: -9.8,
        numericalTolerance: { absolute: 0.05 },
        expectedUnit: "m/s^2",
        expectedSign: "NEGATIVE",
      },
    }],
  }, null);

  const result = reconcileAIExaminerProviderResult(questions, provider("-9.81 m/s^2"), 0.75);
  const row = result.questions[0]!;
  assert.equal(row.engine, "SPECIALIZED_SYMBOLIC");
  assert.equal(row.reviewRequired, true);
  assert.equal(row.suggestedMarks, 4);
  assert.ok(row.specializedEvidence);
  assert.equal(row.specializedEvidence?.checks.find(check => check.criterion === "Numerical value")?.status, "PASS");
  assert.equal(row.specializedEvidence?.checks.find(check => check.criterion === "Unit")?.status, "PASS");
});

test("STEM validation is rejected on ordinary semantic question types", () => {
  assert.throws(() => resolveAIExaminerRubricQuestions({
    questions: [{
      key: "Q1",
      maxMarks: 5,
      criteria: "Explain the poem.",
      questionType: "ESSAY",
      concepts: [],
      stemValidation: { expectedExpression: "x=1" },
    }],
  }, null));
});
