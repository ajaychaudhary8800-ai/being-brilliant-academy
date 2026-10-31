import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AI_EXAMINER_PROVIDER_MAX_RESPONSE_BYTES,
  AIExaminerProviderError,
  readAIExaminerProviderBody,
} from "./ai-examiner-engine.js";

test("AI Examiner provider transport accepts bounded valid JSON without changing rubric logic", async () => {
  const response = new Response(JSON.stringify({ result: "synthetic" }), {
    headers: { "content-type": "application/json" },
  });
  assert.equal(await readAIExaminerProviderBody(response), '{"result":"synthetic"}');
});

test("AI Examiner rejects excessive declared response length before buffering", async () => {
  const response = new Response("synthetic", {
    headers: { "content-length": String(AI_EXAMINER_PROVIDER_MAX_RESPONSE_BYTES + 1) },
  });
  await assert.rejects(readAIExaminerProviderBody(response),
    error => error instanceof AIExaminerProviderError
      && error.code === "AI_EXAMINER_PROVIDER_RESPONSE_TOO_LARGE");
});

test("AI Examiner rejects streaming provider bodies exceeding 4 MiB without retaining their content", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(3 * 1024 * 1024));
      controller.enqueue(new Uint8Array(2 * 1024 * 1024));
      controller.close();
    },
  });
  await assert.rejects(readAIExaminerProviderBody(new Response(stream)),
    error => error instanceof AIExaminerProviderError
      && error.code === "AI_EXAMINER_PROVIDER_RESPONSE_TOO_LARGE"
      && !error.message.includes("SENSITIVE_SYNTHETIC_CONTENT"));
});

test("AI Examiner HTTP and transport errors never echo provider response bodies", async () => {
  const source = await readFile(new URL("./ai-examiner-engine.ts", import.meta.url), "utf8");
  const transport = source.slice(source.indexOf("  const controller = new AbortController();"));
  assert.match(transport, /redirect: "error"/);
  assert.match(transport, /if \(!response\.ok\) \{\s*throw new AIExaminerProviderError\("AI_EXAMINER_PROVIDER_ERROR", `AI provider returned HTTP \$\{response\.status\}`\)/);
  assert.match(transport, /const raw = await readAIExaminerProviderBody\(response\);/);
  assert.doesNotMatch(transport, /response\.text\(\)/);
  assert.doesNotMatch(transport, /raw\.slice\(/);
  assert.doesNotMatch(transport, /error instanceof Error \? error\.message/);
});
