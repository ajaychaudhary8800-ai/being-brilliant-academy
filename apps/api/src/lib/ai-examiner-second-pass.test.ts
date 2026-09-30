import assert from "node:assert/strict";
import test from "node:test";
import { decideAIExaminerSecondPass } from "./ai-examiner-second-pass.js";

test("high-stakes assessments route every question through second-pass verification", () => {
  const decision = decideAIExaminerSecondPass({
    overallConfidence: 0.98,
    confidenceThreshold: 0.75,
    highStakes: true,
    questions: [
      { questionKey: "Q1", confidence: 0.99, suggestedMarks: 4 },
      { questionKey: "Q2", confidence: 0.97, suggestedMarks: 5 },
    ],
  });
  assert.equal(decision.required, true);
  assert.deepEqual(decision.questionKeys, ["Q1", "Q2"]);
  assert.ok(decision.reasons.includes("HIGH_STAKES_ASSESSMENT"));
});

test("low confidence, flags and scoring errors target affected questions", () => {
  const decision = decideAIExaminerSecondPass({
    overallConfidence: 0.8,
    confidenceThreshold: 0.75,
    questions: [
      { questionKey: "Q1", confidence: 0.9, suggestedMarks: 4 },
      { questionKey: "Q2", confidence: 0.6, suggestedMarks: 3 },
      { questionKey: "Q3", confidence: 0.9, suggestedMarks: 2, flags: ["UNCLEAR_HANDWRITING"] },
      { questionKey: "Q4", confidence: 0.9, suggestedMarks: null, scoringError: { code: "ERR", message: "failed" } },
    ],
  });
  assert.equal(decision.required, true);
  assert.deepEqual(decision.questionKeys, ["Q2", "Q3", "Q4"]);
  assert.ok(decision.reasons.includes("LOW_QUESTION_CONFIDENCE"));
  assert.ok(decision.reasons.includes("QUALITY_FLAG"));
  assert.ok(decision.reasons.includes("SCORING_ERROR"));
  assert.ok(decision.reasons.includes("INCOMPLETE_MARKS"));
});

test("specialized verifier failures and review states force second-pass verification", () => {
  const decision = decideAIExaminerSecondPass({
    overallConfidence: 0.95,
    confidenceThreshold: 0.75,
    questions: [
      {
        questionKey: "Q1",
        confidence: 0.95,
        suggestedMarks: 5,
        specializedEvidence: { reviewRequired: true, checks: [{ status: "PASS" }, { status: "REVIEW" }] },
      },
      {
        questionKey: "Q2",
        confidence: 0.95,
        suggestedMarks: 5,
        specializedEvidence: { reviewRequired: true, checks: [{ status: "FAIL" }] },
      },
    ],
  });
  assert.deepEqual(decision.questionKeys, ["Q1", "Q2"]);
  assert.ok(decision.reasons.includes("SPECIALIZED_CHECK_REVIEW"));
  assert.ok(decision.reasons.includes("SPECIALIZED_CHECK_FAILED"));
});

test("clean non-high-stakes evidence does not require a second pass", () => {
  const decision = decideAIExaminerSecondPass({
    overallConfidence: 0.95,
    confidenceThreshold: 0.75,
    questions: [
      { questionKey: "Q1", confidence: 0.95, suggestedMarks: 5 },
    ],
  });
  assert.equal(decision.required, false);
  assert.deepEqual(decision.reasons, []);
  assert.deepEqual(decision.questionKeys, []);
});

test("invalid confidence values are rejected", () => {
  assert.throws(() => decideAIExaminerSecondPass({
    overallConfidence: 1.1,
    confidenceThreshold: 0.75,
    questions: [],
  }));
  assert.throws(() => decideAIExaminerSecondPass({
    overallConfidence: 0.9,
    confidenceThreshold: -0.1,
    questions: [],
  }));
});


test("unverified evidence links force second-pass verification", () => {
  const decision = decideAIExaminerSecondPass({
    overallConfidence: 0.95,
    confidenceThreshold: 0.75,
    questions: [{
      questionKey: "Q1",
      confidence: 0.95,
      suggestedMarks: 4,
      evidenceAudit: { reviewRequired: true, coverageRate: 0.5 },
    }],
  });
  assert.equal(decision.required, true);
  assert.deepEqual(decision.questionKeys, ["Q1"]);
  assert.ok(decision.reasons.includes("EVIDENCE_LINK_UNVERIFIED"));
});
