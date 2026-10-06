import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("OMR scan persistence is tenant scoped and stores token hashes only", async () => {
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = await readFile(new URL("../../prisma/migrations/20260930073000_ai_examiner_scan_ingestion/migration.sql", import.meta.url), "utf8");

  assert.match(schema, /model AIExaminerScanBinding \{/);
  assert.match(schema, /answerSheetId\s+String\s+@unique/);
  assert.match(schema, /tokenHash\s+String\s+@unique/);
  assert.match(schema, /model AIExaminerScanPage \{/);
  assert.match(schema, /@@unique\(\[bindingId, pageNumber\]\)/);
  assert.match(schema, /@@unique\(\[organizationId, scanId\]\)/);
  assert.match(schema, /scanBinding\s+AIExaminerScanBinding\?/);

  assert.match(migration, /CREATE TABLE IF NOT EXISTS "AIExaminerScanBinding"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "AIExaminerScanPage"/);
  assert.match(migration, /AIExaminerScanBinding_organizationId_fkey/);
  assert.match(migration, /AIExaminerScanPage_organizationId_fkey/);
  assert.doesNotMatch(migration, /"scanToken"/);
});

test("OMR API never persists raw scan tokens and locks only clean complete scans", async () => {
  const routes = await readFile(new URL("./ai-examiner.ts", import.meta.url), "utf8");

  assert.match(routes, /router\.post\("\/answer-sheets\/:answerSheetId\/scan-binding"/);
  assert.match(routes, /createAIExaminerScanToken\(\)/);
  assert.match(routes, /hashAIExaminerScanToken\(scanToken\)/);
  assert.match(routes, /router\.post\("\/scan-bindings\/:bindingId\/pages"/);
  assert.match(routes, /assertAIExaminerScanToken\(binding\.tokenHash, body\.scanToken\)/);
  assert.match(routes, /scanToken: "\[redacted\]"/);
  assert.match(routes, /AI_EXAMINER_OMR_NOT_CONFIGURED/);
  assert.match(routes, /AI_EXAMINER_SCAN_ID_REUSED/);
  assert.match(routes, /AIExaminerScanBindingStatus\.LOCKED/);
  assert.match(routes, /pages\.every\(item => item\.status === AIExaminerScanPageStatus\.ACCEPTED\)/);
});

test("trusted OMR evidence is routed into deterministic evaluation with second-pass fallback", async () => {
  const worker = await readFile(new URL("../lib/ai-examiner-worker.ts", import.meta.url), "utf8");
  const orchestration = await readFile(new URL("../lib/ai-examiner-orchestration.ts", import.meta.url), "utf8");

  assert.match(worker, /collectTrustedAIExaminerOmrAnswers/);
  assert.match(worker, /overlayTrustedAIExaminerOmrAnswers/);
  assert.match(worker, /omrReviewRequired: Boolean\(scanBinding\) && !omrEvidence\.trusted/);
  assert.match(worker, /omrEvidenceTrusted/);
  assert.match(orchestration, /questionType === "MSQ"/);
  assert.match(orchestration, /JSON\.stringify\(omr\.selections\)/);
});
