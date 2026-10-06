import { z } from "zod";
import { env } from "../config.js";
import {
  AI_EXAMINER_CODE_LANGUAGES,
  validateAIExaminerCodeRunnerRequest,
  verifyAIExaminerCodeRunnerResult,
  type AIExaminerCodeRunnerRequest,
  type AIExaminerCodeRunnerResult,
  type AIExaminerCodeVerification,
} from "./ai-examiner-code-sandbox.js";

const runnerResultSchema = z.object({
  executionId: z.string().trim().min(1).max(240),
  status: z.enum(["COMPLETED", "FAILED", "TIMED_OUT", "INFRA_ERROR"]),
  exitCode: z.number().int().nullable().optional(),
  peakMemoryMb: z.number().nonnegative().nullable().optional(),
  durationMs: z.number().nonnegative().nullable().optional(),
  stdout: z.string().max(100000).optional(),
  stderr: z.string().max(100000).optional(),
  tests: z.array(z.object({
    key: z.string().trim().min(1).max(80),
    status: z.enum(["PASS", "FAIL", "TIMEOUT", "RUNTIME_ERROR", "OUTPUT_LIMIT", "INFRA_ERROR"]),
    output: z.string().max(100000).optional(),
    durationMs: z.number().nonnegative().optional(),
  })).max(100),
});

export class AIExaminerCodeRunnerError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AIExaminerCodeRunnerError";
  }
}

export function aiExaminerCodeRunnerConfigured() {
  return Boolean(env.AI_EXAMINER_CODE_RUNNER_URL && env.AI_EXAMINER_CODE_RUNNER_TOKEN);
}

export async function runAIExaminerCodeSandbox(request: AIExaminerCodeRunnerRequest): Promise<{
  result: AIExaminerCodeRunnerResult;
  verification: AIExaminerCodeVerification;
}> {
  const validated = validateAIExaminerCodeRunnerRequest(request);
  if (!env.AI_EXAMINER_CODE_RUNNER_URL || !env.AI_EXAMINER_CODE_RUNNER_TOKEN) {
    throw new AIExaminerCodeRunnerError("AI_EXAMINER_CODE_RUNNER_NOT_CONFIGURED", "Isolated code runner is not configured");
  }

  const controller = new AbortController();
  const timeoutMs = Math.max(validated.policy.timeoutMs + 2_000, env.AI_EXAMINER_CODE_RUNNER_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(env.AI_EXAMINER_CODE_RUNNER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.AI_EXAMINER_CODE_RUNNER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        submissionId: validated.submissionId,
        sourceCode: validated.sourceCode,
        policy: {
          ...validated.policy,
          networkAccess: false,
        },
      }),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new AIExaminerCodeRunnerError("AI_EXAMINER_CODE_RUNNER_ERROR", `Code runner returned HTTP ${response.status}: ${raw.slice(0, 1000)}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new AIExaminerCodeRunnerError("AI_EXAMINER_CODE_RUNNER_INVALID_RESPONSE", "Code runner returned a non-JSON response");
    }
    const result = runnerResultSchema.safeParse(parsed);
    if (!result.success) {
      throw new AIExaminerCodeRunnerError(
        "AI_EXAMINER_CODE_RUNNER_INVALID_RESULT",
        `Code runner result failed schema validation: ${result.error.issues.slice(0, 5).map(issue => issue.path.join(".") + " " + issue.message).join("; ")}`,
      );
    }
    const verification = verifyAIExaminerCodeRunnerResult({ request: validated, result: result.data });
    return { result: result.data, verification };
  } catch (error) {
    if (error instanceof AIExaminerCodeRunnerError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AIExaminerCodeRunnerError("AI_EXAMINER_CODE_RUNNER_TIMEOUT", "Isolated code runner timed out");
    }
    throw new AIExaminerCodeRunnerError("AI_EXAMINER_CODE_RUNNER_UNAVAILABLE", error instanceof Error ? error.message : "Isolated code runner unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

export function aiExaminerCodeRunnerReadiness() {
  return {
    configured: aiExaminerCodeRunnerConfigured(),
    languages: [...AI_EXAMINER_CODE_LANGUAGES],
    isolationRequired: true,
    networkAccess: false,
    localExecutionAllowed: false,
  };
}
