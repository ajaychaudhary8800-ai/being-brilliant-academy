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
    overallFeedback: "Chemistry answer extracted for supervised review.",
    confidence: 0.94,
    diagnostics: { weakConcepts: [], strongConcepts: [], qualityFlags: [] },
    questions: [{
      questionKey: "Q1",
      maxMarks: 3,
      awardedMarks: 2,
      confidence: 0.94,
      extractedAnswer,
      feedback: "Equation extracted.",
      rubricBreakdown: [],
      concepts: [],
      flags: [],

      annotationHints: [],
    }],
  };
}

test("chemistry equation validation is retained in rubric configuration", () => {
  const questions = resolveAIExaminerRubricQuestions({
    questions: [{
      key: "Q1",
      maxMarks: 3,
      criteria: "Write and balance the reaction.",
      questionType: "CHEMISTRY_EQUATION",
      concepts: ["Chemical equations"],
      chemistryValidation: {
        expectedEquation: "2H2 + O2 -> 2H2O",
        requireBalanced: true,
        allowReverse: false,
      },
    }],
  }, null);

  assert.equal(questions[0]?.chemistryValidation?.expectedEquation, "2H2 + O2 -> 2H2O");
});

test("chemistry reconciliation adds deterministic balance/ratio evidence but keeps teacher review", () => {
  const questions = resolveAIExaminerRubricQuestions({
    questions: [{
      key: "Q1",
      maxMarks: 3,
      criteria: "Write and balance the reaction.",
      questionType: "CHEMISTRY_EQUATION",
      concepts: ["Chemical equations"],
      chemistryValidation: {
        expectedEquation: "2H2 + O2 -> 2H2O",
      },
    }],
  }, null);

  const result = reconcileAIExaminerProviderResult(
    questions,
    provider("4H2 + 2O2 -> 4H2O"),
    0.75,
  );
  const row = result.questions[0]!;
  assert.equal(row.engine, "SPECIALIZED_SYMBOLIC");
  assert.equal(row.reviewRequired, true);
  assert.equal(row.suggestedMarks, 2);
  assert.ok(row.specializedEvidence && "parsed" in row.specializedEvidence);
  if (row.specializedEvidence && "parsed" in row.specializedEvidence) {
    assert.equal(row.specializedEvidence.parsed, true);
    assert.equal(row.specializedEvidence.checks.find(check => check.criterion === "Atom balance")?.status, "PASS");
    assert.equal(row.specializedEvidence.checks.find(check => check.criterion === "Stoichiometric ratio")?.status, "PASS");
  }
});

test("chemistry validation is rejected on unrelated question types", () => {
  assert.throws(() => resolveAIExaminerRubricQuestions({
    questions: [{
      key: "Q1",
      maxMarks: 3,
      criteria: "Explain.",
      questionType: "SHORT_ANSWER",
      concepts: [],
      chemistryValidation: { expectedEquation: "H2 + O2 -> H2O" },
    }],
  }, null));
});
