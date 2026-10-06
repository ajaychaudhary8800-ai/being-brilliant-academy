import assert from "node:assert/strict";
import test from "node:test";
import {
  aiExaminerRegradeWindow,
  normalizeAIExaminerRegradeQuestionKeys,
  regradePolicyFromExamSnapshot,
  resultRevisionSnapshot,
} from "./ai-examiner-regrade.js";

test("historical exams without a valid profile fail closed for self-service regrade", () => {
  const policy = regradePolicyFromExamSnapshot(null);
  assert.equal(policy.enabled, false);
  assert.equal(policy.allowStudentRequest, false);
  assert.equal(policy.allowParentRequest, false);
});

test("question-set regrade requires known explicit question keys", () => {
  assert.deepEqual(normalizeAIExaminerRegradeQuestionKeys({
    scope: "QUESTION_SET",
    questionKeys: ["q1", "Q2", "q1"],
    availableQuestionKeys: ["Q1", "Q2", "Q3"],
  }), ["Q1", "Q2"]);

  assert.throws(() => normalizeAIExaminerRegradeQuestionKeys({
    scope: "QUESTION_SET",
    questionKeys: [],
    availableQuestionKeys: ["Q1"],
  }));

  assert.throws(() => normalizeAIExaminerRegradeQuestionKeys({
    scope: "QUESTION_SET",
    questionKeys: ["Q9"],
    availableQuestionKeys: ["Q1"],
  }));
});

test("whole-script and clerical scopes do not accept hidden question subsets", () => {
  assert.throws(() => normalizeAIExaminerRegradeQuestionKeys({
    scope: "WHOLE_SCRIPT",
    questionKeys: ["Q1"],
    availableQuestionKeys: ["Q1"],
  }));
  assert.deepEqual(normalizeAIExaminerRegradeQuestionKeys({
    scope: "CLERICAL_CHECK",
    availableQuestionKeys: ["Q1"],
  }), []);
});

test("regrade request window is based on the recorded result publication audit time", () => {
  const publishedAt = new Date("2026-09-01T00:00:00.000Z");
  assert.equal(aiExaminerRegradeWindow({
    publishedAt,
    requestWindowDays: 7,
    now: new Date("2026-09-08T00:00:00.000Z"),
  }).open, true);
  assert.equal(aiExaminerRegradeWindow({
    publishedAt,
    requestWindowDays: 7,
    now: new Date("2026-09-08T00:00:00.001Z"),
  }).open, false);
});

test("result revision snapshots normalize Decimal-like values into JSON-safe numbers", () => {
  const snapshot = resultRevisionSnapshot({
    marksObtained: { valueOf: () => 82 },
    percentage: "82",
    grade: "A",
    gpa: 9,
    rank: 2,
    status: "PASS",
    remarks: "Published",
    generatedAt: new Date("2026-09-01T00:00:00.000Z"),
  });
  assert.equal(snapshot.marksObtained, 82);
  assert.equal(snapshot.percentage, 82);
  assert.equal(snapshot.generatedAt, "2026-09-01T00:00:00.000Z");
});
