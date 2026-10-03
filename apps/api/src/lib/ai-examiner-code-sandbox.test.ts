import assert from "node:assert/strict";
import test from "node:test";
import {
  AIExaminerCodePolicyError,
  validateAIExaminerCodeRunnerRequest,
  verifyAIExaminerCodeRunnerResult,
} from "./ai-examiner-code-sandbox.js";

const request = {
  submissionId: "submission-1",
  sourceCode: "print(input())",
  policy: {
    language: "PYTHON" as const,
    timeoutMs: 2000,
    memoryMb: 128,
    maxOutputBytes: 4096,
    networkAccess: false as const,
    fileSystem: "EPHEMERAL" as const,
    testCases: [
      { key: "visible-1", input: "2", expectedOutput: "2", weight: 2 },
      { key: "hidden-1", input: "10", expectedOutput: "10", weight: 3, hidden: true },
    ],
  },
};

test("code sandbox contract accepts bounded isolated execution policies", () => {
  assert.equal(validateAIExaminerCodeRunnerRequest(request), request);
});

test("code sandbox contract rejects network access and excessive limits", () => {
  assert.throws(() => validateAIExaminerCodeRunnerRequest({
    ...request,
    policy: { ...request.policy, networkAccess: true as never },
  }), (error: unknown) => error instanceof AIExaminerCodePolicyError && error.code === "AI_EXAMINER_CODE_NETWORK_FORBIDDEN");

  assert.throws(() => validateAIExaminerCodeRunnerRequest({
    ...request,
    policy: { ...request.policy, timeoutMs: 10001 },
  }), (error: unknown) => error instanceof AIExaminerCodePolicyError && error.code === "AI_EXAMINER_CODE_TIMEOUT_INVALID");

  assert.throws(() => validateAIExaminerCodeRunnerRequest({
    ...request,
    policy: { ...request.policy, memoryMb: 1024 },
  }), (error: unknown) => error instanceof AIExaminerCodePolicyError && error.code === "AI_EXAMINER_CODE_MEMORY_INVALID");
});

test("completed sandbox results calculate weighted evidence but still require teacher review", () => {
  const verification = verifyAIExaminerCodeRunnerResult({
    request,
    result: {
      executionId: "exec-1",
      status: "COMPLETED",
      exitCode: 0,
      durationMs: 250,
      peakMemoryMb: 24,
      tests: [
        { key: "visible-1", status: "PASS", output: "2", durationMs: 20 },
        { key: "hidden-1", status: "FAIL", output: "sensitive-hidden-output", durationMs: 25 },
      ],
    },
  });

  assert.equal(verification.engine, "CODE_SANDBOX");
  assert.equal(verification.reviewRequired, true);
  assert.equal(verification.executionAccepted, true);
  assert.equal(verification.passedWeight, 2);
  assert.equal(verification.totalWeight, 5);
  assert.equal(verification.scoreFraction, 0.4);
  assert.equal((verification.checks.find(row => row.criterion === "Test hidden-1")?.observed as { output?: string }).output, "[hidden]");
});

test("infrastructure and timeout outcomes never become automatic grading evidence", () => {
  const verification = verifyAIExaminerCodeRunnerResult({
    request,
    result: {
      executionId: "exec-2",
      status: "TIMED_OUT",
      tests: [],
    },
  });
  assert.equal(verification.executionAccepted, false);
  assert.equal(verification.reviewRequired, true);
  assert.equal(verification.scoreFraction, 0);
  assert.equal(verification.checks[0]?.status, "REVIEW");
});

test("runner omissions force review even when the execution status says completed", () => {
  const verification = verifyAIExaminerCodeRunnerResult({
    request,
    result: {
      executionId: "exec-3",
      status: "COMPLETED",
      tests: [{ key: "visible-1", status: "PASS" }],
    },
  });
  assert.equal(verification.executionAccepted, false);
  assert.equal(verification.reviewRequired, true);
  assert.equal(verification.checks.find(row => row.criterion === "Test hidden-1")?.status, "REVIEW");
});
