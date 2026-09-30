export const AI_EXAMINER_CODE_LANGUAGES = [
  "PYTHON",
  "JAVASCRIPT",
  "TYPESCRIPT",
  "JAVA",
  "C",
  "CPP",
] as const;

export type AIExaminerCodeLanguage = typeof AI_EXAMINER_CODE_LANGUAGES[number];

export type AIExaminerCodeTestCase = {
  key: string;
  input?: string;
  expectedOutput?: string;
  weight: number;
  hidden?: boolean;
};

export type AIExaminerCodeExecutionPolicy = {
  language: AIExaminerCodeLanguage;
  runtimeVersion?: string;
  timeoutMs: number;
  memoryMb: number;
  maxOutputBytes: number;
  networkAccess: false;
  fileSystem: "NONE" | "EPHEMERAL";
  testCases: AIExaminerCodeTestCase[];
};

export type AIExaminerCodeRunnerRequest = {
  submissionId: string;
  sourceCode: string;
  policy: AIExaminerCodeExecutionPolicy;
};

export type AIExaminerCodeTestResult = {
  key: string;
  status: "PASS" | "FAIL" | "TIMEOUT" | "RUNTIME_ERROR" | "OUTPUT_LIMIT" | "INFRA_ERROR";
  output?: string;
  durationMs?: number;
};

export type AIExaminerCodeRunnerResult = {
  executionId: string;
  status: "COMPLETED" | "FAILED" | "TIMED_OUT" | "INFRA_ERROR";
  exitCode?: number | null;
  peakMemoryMb?: number | null;
  durationMs?: number | null;
  stdout?: string;
  stderr?: string;
  tests: AIExaminerCodeTestResult[];
};

export type AIExaminerCodeVerification = {
  engine: "CODE_SANDBOX";
  reviewRequired: true;
  executionAccepted: boolean;
  passedWeight: number;
  totalWeight: number;
  scoreFraction: number;
  checks: Array<{
    criterion: string;
    status: "PASS" | "FAIL" | "REVIEW";
    rationale: string;
    expected?: unknown;
    observed?: unknown;
  }>;
};

export class AIExaminerCodePolicyError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AIExaminerCodePolicyError";
  }
}

const MAX_SOURCE_BYTES = 100_000;
const MAX_TESTS = 100;
const MAX_TIMEOUT_MS = 10_000;
const MAX_MEMORY_MB = 512;
const MAX_OUTPUT_BYTES = 64_000;

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export function validateAIExaminerCodeRunnerRequest(input: AIExaminerCodeRunnerRequest): AIExaminerCodeRunnerRequest {
  if (!input.submissionId.trim()) {
    throw new AIExaminerCodePolicyError("AI_EXAMINER_CODE_SUBMISSION_INVALID", "Submission ID is required");
  }
  if (!input.sourceCode.trim()) {
    throw new AIExaminerCodePolicyError("AI_EXAMINER_CODE_SOURCE_EMPTY", "Source code is required");
  }
  if (utf8Bytes(input.sourceCode) > MAX_SOURCE_BYTES) {
    throw new AIExaminerCodePolicyError("AI_EXAMINER_CODE_SOURCE_TOO_LARGE", "Source code exceeds the sandbox input limit");
  }
  if (!(AI_EXAMINER_CODE_LANGUAGES as readonly string[]).includes(input.policy.language)) {
    throw new AIExaminerCodePolicyError("AI_EXAMINER_CODE_LANGUAGE_UNSUPPORTED", "Programming language is not supported by the sandbox contract");
  }
  if (input.policy.networkAccess !== false) {
    throw new AIExaminerCodePolicyError("AI_EXAMINER_CODE_NETWORK_FORBIDDEN", "Network access must remain disabled for assessment code execution");
  }
  if (!Number.isInteger(input.policy.timeoutMs) || input.policy.timeoutMs < 100 || input.policy.timeoutMs > MAX_TIMEOUT_MS) {
    throw new AIExaminerCodePolicyError("AI_EXAMINER_CODE_TIMEOUT_INVALID", "Sandbox timeout is outside the allowed range");
  }
  if (!Number.isInteger(input.policy.memoryMb) || input.policy.memoryMb < 16 || input.policy.memoryMb > MAX_MEMORY_MB) {
    throw new AIExaminerCodePolicyError("AI_EXAMINER_CODE_MEMORY_INVALID", "Sandbox memory limit is outside the allowed range");
  }
  if (!Number.isInteger(input.policy.maxOutputBytes) || input.policy.maxOutputBytes < 256 || input.policy.maxOutputBytes > MAX_OUTPUT_BYTES) {
    throw new AIExaminerCodePolicyError("AI_EXAMINER_CODE_OUTPUT_LIMIT_INVALID", "Sandbox output limit is outside the allowed range");
  }
  if (!Array.isArray(input.policy.testCases) || input.policy.testCases.length < 1 || input.policy.testCases.length > MAX_TESTS) {
    throw new AIExaminerCodePolicyError("AI_EXAMINER_CODE_TESTS_INVALID", "Programming assessment must define between 1 and 100 test cases");
  }

  const keys = new Set<string>();
  for (const test of input.policy.testCases) {
    const key = test.key.trim().toLowerCase();
    if (!key || keys.has(key)) {
      throw new AIExaminerCodePolicyError("AI_EXAMINER_CODE_TEST_KEY_INVALID", "Code test-case keys must be non-empty and unique");
    }
    keys.add(key);
    if (!Number.isFinite(test.weight) || test.weight <= 0 || test.weight > 10000) {
      throw new AIExaminerCodePolicyError("AI_EXAMINER_CODE_TEST_WEIGHT_INVALID", "Code test-case weight must be a positive finite number");
    }
  }

  return input;
}

function boundedText(value: string | undefined, maxBytes: number) {
  if (!value) return value;
  if (utf8Bytes(value) <= maxBytes) return value;
  return value.slice(0, Math.max(0, Math.floor(maxBytes / 2))) + "…[truncated]";
}

export function verifyAIExaminerCodeRunnerResult(input: {
  request: AIExaminerCodeRunnerRequest;
  result: AIExaminerCodeRunnerResult;
}): AIExaminerCodeVerification {
  const request = validateAIExaminerCodeRunnerRequest(input.request);
  const checks: AIExaminerCodeVerification["checks"] = [];

  if (input.result.status !== "COMPLETED") {
    checks.push({
      criterion: "Sandbox execution",
      status: "REVIEW",
      rationale: "The isolated runner did not complete successfully; no automatic code marks should be finalized.",
      observed: input.result.status,
    });
    return {
      engine: "CODE_SANDBOX",
      reviewRequired: true,
      executionAccepted: false,
      passedWeight: 0,
      totalWeight: request.policy.testCases.reduce((sum, test) => sum + test.weight, 0),
      scoreFraction: 0,
      checks,
    };
  }

  if (input.result.durationMs != null && input.result.durationMs > request.policy.timeoutMs) {
    checks.push({
      criterion: "Execution time",
      status: "REVIEW",
      rationale: "Runner reported a duration above the configured timeout; execution evidence is not trusted automatically.",
      expected: request.policy.timeoutMs,
      observed: input.result.durationMs,
    });
  }
  if (input.result.peakMemoryMb != null && input.result.peakMemoryMb > request.policy.memoryMb) {
    checks.push({
      criterion: "Memory use",
      status: "REVIEW",
      rationale: "Runner reported memory above the configured sandbox limit; execution evidence requires review.",
      expected: request.policy.memoryMb,
      observed: input.result.peakMemoryMb,
    });
  }

  const resultByKey = new Map(input.result.tests.map(test => [test.key.toLowerCase(), test]));
  let passedWeight = 0;
  let totalWeight = 0;

  for (const test of request.policy.testCases) {
    totalWeight += test.weight;
    const observed = resultByKey.get(test.key.toLowerCase());
    if (!observed) {
      checks.push({
        criterion: `Test ${test.key}`,
        status: "REVIEW",
        rationale: "The runner did not return a result for this configured test case.",
      });
      continue;
    }
    if (observed.status === "PASS") passedWeight += test.weight;
    checks.push({
      criterion: `Test ${test.key}`,
      status: observed.status === "PASS" ? "PASS" : observed.status === "FAIL" ? "FAIL" : "REVIEW",
      rationale: observed.status === "PASS"
        ? "The isolated runner reports that the test case passed."
        : observed.status === "FAIL"
          ? "The isolated runner reports that the test case failed."
          : "The test did not produce a normal pass/fail result and requires review.",
      observed: {
        status: observed.status,
        durationMs: observed.durationMs,
        output: test.hidden ? "[hidden]" : boundedText(observed.output, 2000),
      },
    });
  }

  const scoreFraction = totalWeight > 0 ? Math.max(0, Math.min(1, passedWeight / totalWeight)) : 0;
  return {
    engine: "CODE_SANDBOX",
    reviewRequired: true,
    executionAccepted: checks.every(check => check.criterion.startsWith("Test ") || check.status !== "REVIEW"),
    passedWeight: Math.round(passedWeight * 10000) / 10000,
    totalWeight: Math.round(totalWeight * 10000) / 10000,
    scoreFraction: Math.round(scoreFraction * 1000000) / 1000000,
    checks,
  };
}

export const aiExaminerCodeSandboxLimits = {
  maxSourceBytes: MAX_SOURCE_BYTES,
  maxTests: MAX_TESTS,
  maxTimeoutMs: MAX_TIMEOUT_MS,
  maxMemoryMb: MAX_MEMORY_MB,
  maxOutputBytes: MAX_OUTPUT_BYTES,
} as const;
