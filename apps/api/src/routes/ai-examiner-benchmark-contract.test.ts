import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("AI Examiner benchmark framework is tenant-scoped, auditable and separate from release readiness", async () => {
  const [schema, migration, route, benchmark] = await Promise.all([
    readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../../prisma/migrations/20260930062000_ai_examiner_benchmarks/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("ai-examiner.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai-examiner-benchmark.ts", import.meta.url), "utf8"),
  ]);

  assert.match(schema, /model AIExaminerBenchmarkSuite/);
  assert.match(schema, /model AIExaminerBenchmarkCase/);
  assert.match(schema, /model AIExaminerBenchmarkRun/);
  assert.match(schema, /model AIExaminerBenchmarkResult/);
  assert.match(schema, /minimumMarks\s+Decimal/);
  assert.match(schema, /benchmarkReady\s+Boolean/);
  assert.match(schema, /@@unique\(\[suiteId, sourceAnswerSheetId, questionKey\]\)/);

  assert.match(migration, /CREATE TYPE "AIExaminerBenchmarkSuiteStatus"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "AIExaminerBenchmarkSuite"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "AIExaminerBenchmarkCase"/);
  assert.match(migration, /"minimumMarks" DECIMAL\(8,2\) NOT NULL DEFAULT 0/);
  assert.match(migration, /AIExaminerBenchmarkCase_suiteId_sourceAnswerSheetId_questionKey_key/);
  assert.doesNotMatch(migration, /DO \$ BEGIN|END \$;/);

  assert.match(route, /router\.get\("\/benchmark-suites"/);
  assert.match(route, /router\.post\("\/benchmark-suites"/);
  assert.match(route, /\/benchmark-suites\/:suiteId\/cases/);
  assert.match(route, /\/benchmark-suites\/:suiteId\/activate/);
  assert.match(route, /\/benchmark-suites\/:suiteId\/runs/);
  assert.match(route, /router\.get\("\/benchmark-suites\/:suiteId\/cases"/);
  assert.match(route, /router\.get\("\/benchmark-suites\/:suiteId\/evaluation-results"/);
  assert.match(route, /AIExaminerEvaluationStatus\.APPROVED/);
  assert.match(route, /readyForRun: cases\.length > 0 && missing\.length === 0 && Boolean\(context\)/);
  assert.match(route, /where: \\{ id: req\\.auth!\\.userId, organizationId: req\\.auth!\\.organizationId, isActive: true \\}/);
  assert.doesNotMatch(route, /humanReviewerId: cuid/);
  assert.match(route, /AI_EXAMINER_BENCHMARK_SOURCE_NOT_FINAL/);
  assert.match(route, /benchmarkReady: gate\.ready && !driftAssessment\?\.driftDetected/);
  assert.match(route, /releaseReady: false/);
  assert.match(route, /Benchmark readiness is only one release gate/);

  assert.match(benchmark, /maximumNormalizedMae/);
  assert.match(benchmark, /minimumWithinToleranceRate/);
  assert.match(benchmark, /maximumOverrideRate/);
  assert.match(benchmark, /maximumLowConfidenceRate/);
  assert.match(benchmark, /assessAIExaminerBenchmarkDrift/);
  assert.match(benchmark, /groupAIExaminerBenchmarkMetrics/);
});
