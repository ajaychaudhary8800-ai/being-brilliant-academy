import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("AI Examiner admin workspace exposes benchmark management without enabling it for teachers", async () => {
  const [foundation, benchmark] = await Promise.all([
    readFile(new URL("./ai-examiner-foundation.tsx", import.meta.url), "utf8"),
    readFile(new URL("./ai-examiner-benchmarks.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(foundation, /AIExaminerBenchmarkPanel/);
  assert.match(foundation, /!teacherView&&selectedExam&&<AIExaminerBenchmarkPanel/);

  assert.match(benchmark, /Benchmark Management/);
  assert.match(benchmark, /human-gold calibration suites/);
  assert.match(benchmark, /minimumCases: 20/);
  assert.match(benchmark, /\/ai-examiner\/benchmark-suites/);
  assert.match(benchmark, /\/cases/);
  assert.match(benchmark, /\/evaluation-results/);
  assert.match(benchmark, /\/runs/);
  assert.match(benchmark, /does not certify physical devices or authorize a production deployment/);
});

test("benchmark UI only offers finalized answer sheets as human-gold sources", async () => {
  const benchmark = await readFile(new URL("./ai-examiner-benchmarks.tsx", import.meta.url), "utf8");
  assert.match(benchmark, /filter\(sheet => Boolean\(sheet\.finalizedAt\)\)/);
  assert.doesNotMatch(benchmark, /humanReviewerId/);
  assert.match(benchmark, /Human gold marks/);
  assert.match(benchmark, /Run Current Engine/);
});
