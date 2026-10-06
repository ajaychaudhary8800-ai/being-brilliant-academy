import assert from "node:assert/strict";
import test from "node:test";
import { assessAIExaminerReviewCompletion } from "./ai-examiner-review-policy.js";

const doubleBlind = {
  mode: "DOUBLE_BLIND" as const,
  independentReviewers: 2,
  anonymizeStudentIdentity: true,
  reviewersSeePriorMarks: false,
  moderationRequired: false,
  discrepancyThresholdMarks: 2,
  discrepancyThresholdRatio: 0.05,
};

test("standard policy keeps legacy single-review finalization compatible", () => {
  const result = assessAIExaminerReviewCompletion({
    policy: {
      mode: "STANDARD",
      independentReviewers: 1,
      anonymizeStudentIdentity: false,
      reviewersSeePriorMarks: true,
      moderationRequired: false,
      discrepancyThresholdMarks: 0,
      discrepancyThresholdRatio: 0,
    },
    rounds: [],
    maximumMarks: 100,
  });
  assert.equal(result.readyToFinalize, true);
});

test("double-blind policy blocks until two distinct reviewers submit", () => {
  const result = assessAIExaminerReviewCompletion({
    policy: doubleBlind,
    rounds: [
      { reviewerId: "u1", kind: "PRIMARY", status: "SUBMITTED", totalMarks: 70 },
      { reviewerId: "u1", kind: "SECONDARY", status: "SUBMITTED", totalMarks: 71 },
    ],
    maximumMarks: 100,
  });
  assert.equal(result.readyToFinalize, false);
  assert.equal(result.submittedIndependentReviewers, 1);
});

test("mark discrepancy requires a submitted moderation round", () => {
  const withoutModeration = assessAIExaminerReviewCompletion({
    policy: doubleBlind,
    rounds: [
      { reviewerId: "u1", kind: "PRIMARY", status: "SUBMITTED", totalMarks: 70 },
      { reviewerId: "u2", kind: "SECONDARY", status: "SUBMITTED", totalMarks: 74 },
    ],
    maximumMarks: 100,
  });
  assert.equal(withoutModeration.moderationRequired, true);
  assert.equal(withoutModeration.readyToFinalize, false);

  const moderated = assessAIExaminerReviewCompletion({
    policy: doubleBlind,
    rounds: [
      { reviewerId: "u1", kind: "PRIMARY", status: "SUBMITTED", totalMarks: 70 },
      { reviewerId: "u2", kind: "SECONDARY", status: "SUBMITTED", totalMarks: 74 },
      { reviewerId: "u3", kind: "MODERATION", status: "SUBMITTED", totalMarks: 72 },
    ],
    maximumMarks: 100,
  });
  assert.equal(moderated.readyToFinalize, true);
  assert.equal(moderated.moderationSubmitted, true);
});
