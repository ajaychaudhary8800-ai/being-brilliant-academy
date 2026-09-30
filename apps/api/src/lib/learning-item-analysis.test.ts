import assert from "node:assert/strict";
import test from "node:test";
import { calculateLearningTestPsychometrics } from "./learning-item-analysis.js";

test("item analysis calculates facility, discrimination, distractors and reliability", () => {
  const report = calculateLearningTestPsychometrics({
    items: [
      { questionId: "q1", maxMarks: 1, correctAnswer: "A" },
      { questionId: "q2", maxMarks: 1, correctAnswer: "B" },
    ],
    attempts: [
      { studentId: "s1", totalScore: 2, responses: [
        { questionId: "q1", answer: "A", isCorrect: true, awardedMarks: 1, timeSpentSeconds: 10 },
        { questionId: "q2", answer: "B", isCorrect: true, awardedMarks: 1, timeSpentSeconds: 20 },
      ]},
      { studentId: "s2", totalScore: 1, responses: [
        { questionId: "q1", answer: "A", isCorrect: true, awardedMarks: 1, timeSpentSeconds: 12 },
        { questionId: "q2", answer: "C", isCorrect: false, awardedMarks: 0, timeSpentSeconds: 30 },
      ]},
      { studentId: "s3", totalScore: 1, responses: [
        { questionId: "q1", answer: "D", isCorrect: false, awardedMarks: 0, timeSpentSeconds: 18 },
        { questionId: "q2", answer: "B", isCorrect: true, awardedMarks: 1, timeSpentSeconds: 25 },
      ]},
      { studentId: "s4", totalScore: 0, responses: [
        { questionId: "q1", answer: "D", isCorrect: false, awardedMarks: 0, timeSpentSeconds: 24 },
        { questionId: "q2", answer: null, isCorrect: null, awardedMarks: null, timeSpentSeconds: 0 },
      ]},
    ],
  });

  assert.equal(report.attemptCount, 4);
  assert.equal(report.items[0]?.facility, 0.5);
  assert.equal(report.items[0]?.discrimination, 1);
  assert.equal(report.items[1]?.nonResponseRate, 0.25);
  assert.equal(report.items[1]?.distractors.find(row => row.answer === "B")?.count, 2);
  assert.equal(typeof report.reliabilityAlpha, "number");
});

test("item analysis handles small samples and no variance without inventing reliability", () => {
  const report = calculateLearningTestPsychometrics({
    items: [{ questionId: "q1", maxMarks: 2 }],
    attempts: [{ studentId: "s1", totalScore: 0, responses: [] }],
  });
  assert.equal(report.reliabilityAlpha, null);
  assert.equal(report.items[0]?.facility, 0);
  assert.equal(report.items[0]?.nonResponseRate, 1);
  assert.ok(report.items[0]?.flags.includes("SMALL_SAMPLE"));
  assert.ok(report.items[0]?.flags.includes("VERY_DIFFICULT"));
});

test("negative discrimination is explicitly flagged for review", () => {
  const report = calculateLearningTestPsychometrics({
    items: [{ questionId: "q1", maxMarks: 1 }],
    attempts: [
      { studentId: "s1", totalScore: 10, responses: [{ questionId: "q1", answer: "X", isCorrect: false, awardedMarks: 0, timeSpentSeconds: 5 }] },
      { studentId: "s2", totalScore: 8, responses: [{ questionId: "q1", answer: "X", isCorrect: false, awardedMarks: 0, timeSpentSeconds: 5 }] },
      { studentId: "s3", totalScore: 2, responses: [{ questionId: "q1", answer: "A", isCorrect: true, awardedMarks: 1, timeSpentSeconds: 5 }] },
      { studentId: "s4", totalScore: 1, responses: [{ questionId: "q1", answer: "A", isCorrect: true, awardedMarks: 1, timeSpentSeconds: 5 }] },
    ],
  });
  assert.equal(report.items[0]?.discrimination, -1);
  assert.ok(report.items[0]?.flags.includes("NEGATIVE_DISCRIMINATION"));
});
