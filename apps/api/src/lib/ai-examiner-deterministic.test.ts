import assert from "node:assert/strict";
import test from "node:test";
import { AIExaminerScoringError, scoreDeterministicQuestion } from "./ai-examiner-deterministic.js";

test("MCQ supports positive marks, negative marking and unanswered marks", () => {
  const correct = scoreDeterministicQuestion({
    questionKey: "Q1", questionType: "MCQ", maxMarks: 4, correctAnswer: "B", studentAnswer: "b",
    scoring: { correctMarks: 4, incorrectMarks: -1 },
  });
  assert.equal(correct.status, "CORRECT");
  assert.equal(correct.awardedMarks, 4);

  const wrong = scoreDeterministicQuestion({
    questionKey: "Q1", questionType: "MCQ", maxMarks: 4, correctAnswer: "B", studentAnswer: "A",
    scoring: { correctMarks: 4, incorrectMarks: -1 },
  });
  assert.equal(wrong.status, "INCORRECT");
  assert.equal(wrong.awardedMarks, -1);

  const blank = scoreDeterministicQuestion({
    questionKey: "Q1", questionType: "MCQ", maxMarks: 4, correctAnswer: "B", studentAnswer: " ",
    scoring: { correctMarks: 4, incorrectMarks: -1, unansweredMarks: 0 },
  });
  assert.equal(blank.status, "UNANSWERED");
  assert.equal(blank.awardedMarks, 0);
});

test("MSQ supports proportional partial credit only when configured", () => {
  const partial = scoreDeterministicQuestion({
    questionKey: "Q2", questionType: "MSQ", maxMarks: 4, correctAnswer: ["A", "C", "D"], studentAnswer: ["A", "D"],
    scoring: { partialMode: "PROPORTIONAL_NO_WRONG" },
  });
  assert.equal(partial.status, "PARTIAL");
  assert.equal(partial.awardedMarks, 2.6667);

  const wrongSelection = scoreDeterministicQuestion({
    questionKey: "Q2", questionType: "MSQ", maxMarks: 4, correctAnswer: ["A", "C", "D"], studentAnswer: ["A", "B"],
    scoring: { partialMode: "PROPORTIONAL_NO_WRONG", incorrectMarks: -2 },
  });
  assert.equal(wrongSelection.status, "INCORRECT");
  assert.equal(wrongSelection.awardedMarks, -2);
});

test("fill blank and one-word answers accept configured aliases", () => {
  const result = scoreDeterministicQuestion({
    questionKey: "Q3", questionType: "FILL_BLANK", maxMarks: 1,
    correctAnswer: ["newton", "sir isaac newton"], studentAnswer: " Sir   Isaac Newton ",
  });
  assert.equal(result.status, "CORRECT");
  assert.equal(result.awardedMarks, 1);
});

test("matching questions can award proportional pair credit", () => {
  const result = scoreDeterministicQuestion({
    questionKey: "Q4", questionType: "MATCHING", maxMarks: 4,
    correctAnswer: { A: "1", B: "2", C: "3", D: "4" },
    studentAnswer: { A: "1", B: "9", C: "3", D: "8" },
    scoring: { partialMode: "PROPORTIONAL_WITH_PENALTY" },
  });
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.awardedMarks, 2);
});

test("numerical questions support absolute and relative tolerance", () => {
  const absolute = scoreDeterministicQuestion({
    questionKey: "Q5", questionType: "NUMERICAL", maxMarks: 4,
    correctAnswer: 9.81, studentAnswer: "9.80",
    scoring: { numericalTolerance: { absolute: 0.02 } },
  });
  assert.equal(absolute.status, "CORRECT");

  const relative = scoreDeterministicQuestion({
    questionKey: "Q6", questionType: "NUMERICAL", maxMarks: 4,
    correctAnswer: 1000, studentAnswer: 1005,
    scoring: { numericalTolerance: { relative: 0.01 } },
  });
  assert.equal(relative.status, "CORRECT");
});

test("invalid deterministic scoring configuration fails closed", () => {
  assert.throws(
    () => scoreDeterministicQuestion({
      questionKey: "Q7", questionType: "MCQ", maxMarks: 4,
      correctAnswer: "A", studentAnswer: "A", scoring: { correctMarks: 5 },
    }),
    (error: unknown) => error instanceof AIExaminerScoringError && error.code === "AI_EXAMINER_SCORING_RULE_INVALID",
  );
});
