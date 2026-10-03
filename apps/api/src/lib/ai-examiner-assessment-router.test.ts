import assert from "node:assert/strict";
import test from "node:test";
import { routeAIExaminerQuestion } from "./ai-examiner-assessment-router.js";

test("objective question types route to deterministic scoring", () => {
  assert.equal(routeAIExaminerQuestion({ questionType: "MCQ" }).engine, "DETERMINISTIC_OBJECTIVE");
  assert.equal(routeAIExaminerQuestion({ questionType: "MATCHING" }).deterministic, true);
  assert.equal(routeAIExaminerQuestion({ questionType: "NUMERICAL" }).engine, "DETERMINISTIC_NUMERIC");
});

test("subjective and specialized responses remain human supervised", () => {
  const essay = routeAIExaminerQuestion({ questionType: "ESSAY" });
  assert.equal(essay.engine, "RUBRIC_SEMANTIC");
  assert.equal(essay.humanReviewRequired, true);

  const derivation = routeAIExaminerQuestion({ questionType: "DERIVATION" });
  assert.equal(derivation.engine, "SPECIALIZED_SYMBOLIC");
  assert.equal(derivation.humanReviewRequired, true);
});

test("visual and programming responses use specialized routes", () => {
  assert.equal(routeAIExaminerQuestion({ questionType: "DIAGRAM" }).engine, "MULTIMODAL");
  assert.equal(routeAIExaminerQuestion({ questionType: "PROGRAMMING" }).engine, "CODE_SANDBOX");
  assert.equal(routeAIExaminerQuestion({ questionType: "SHORT_ANSWER", requiresVisualEvidence: true }).engine, "MULTIMODAL");
});
