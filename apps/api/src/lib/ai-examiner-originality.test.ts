import assert from "node:assert/strict";
import test from "node:test";
import { analyzeAIExaminerOriginality } from "./ai-examiner-originality.js";

const repeated = "The induced current opposes the change in magnetic flux that produces it according to Lenz law and energy conservation.";
const different = "The student calculated acceleration from the gradient of the velocity time graph and then used the area for displacement.";

test("originality analysis flags highly similar long-form answers for review only", () => {
  const report = analyzeAIExaminerOriginality([
    { answerSheetId: "a", studentId: "s1", questionKey: "Q3", text: repeated + " " + repeated },
    { answerSheetId: "b", studentId: "s2", questionKey: "Q3", text: repeated + " " + repeated },
    { answerSheetId: "c", studentId: "s3", questionKey: "Q3", text: different + " " + different },
  ], { minimumTokens: 12, signalThreshold: 0.75 });

  assert.equal(report.signals.length, 1);
  assert.equal(report.signals[0]?.studentAId, "s1");
  assert.equal(report.signals[0]?.studentBId, "s2");
  assert.equal(report.signals[0]?.reviewRequired, true);
  assert.equal(report.signals[0]?.interpretation, "TEXT_SIMILARITY_SIGNAL");
  assert.match(report.warning, /does not establish plagiarism/i);
});

test("short answers and different question keys are not compared as plagiarism evidence", () => {
  const report = analyzeAIExaminerOriginality([
    { answerSheetId: "a", studentId: "s1", questionKey: "Q1", text: "same answer" },
    { answerSheetId: "b", studentId: "s2", questionKey: "Q1", text: "same answer" },
    { answerSheetId: "c", studentId: "s3", questionKey: "Q2", text: repeated + " " + repeated },
    { answerSheetId: "d", studentId: "s4", questionKey: "Q3", text: repeated + " " + repeated },
  ], { minimumTokens: 10, signalThreshold: 0.5 });
  assert.equal(report.signals.length, 0);
  assert.equal(report.comparedPairs, 0);
});

test("same student duplicate data is not compared against itself", () => {
  const text = repeated + " " + repeated;
  const report = analyzeAIExaminerOriginality([
    { answerSheetId: "a", studentId: "s1", questionKey: "Q1", text },
    { answerSheetId: "b", studentId: "s1", questionKey: "Q1", text },
  ], { minimumTokens: 10 });
  assert.equal(report.comparedPairs, 0);
});

test("originality configuration validates defensively", () => {
  assert.throws(() => analyzeAIExaminerOriginality([], { shingleSize: 1 }));
  assert.throws(() => analyzeAIExaminerOriginality([], { minimumTokens: 2, shingleSize: 5 }));
  assert.throws(() => analyzeAIExaminerOriginality([], { signalThreshold: 0.2 }));
});
