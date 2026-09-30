import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("AI Examiner review-round persistence is tenant scoped and auditable", async () => {
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = await readFile(new URL("../../prisma/migrations/20260930070000_ai_examiner_review_rounds/migration.sql", import.meta.url), "utf8");

  assert.match(schema, /model AIExaminerReviewRound \{/);
  assert.match(schema, /model AIExaminerReviewDecision \{/);
  assert.match(schema, /organizationId\s+String/);
  assert.match(schema, /sourceIdentityMasked\s+Boolean/);
  assert.match(schema, /@@unique\(\[evaluationId, sequence\]\)/);
  assert.match(schema, /@@unique\(\[reviewRoundId, questionEvaluationId\]\)/);

  assert.match(migration, /CREATE TABLE IF NOT EXISTS "AIExaminerReviewRound"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "AIExaminerReviewDecision"/);
  assert.match(migration, /AIExaminerReviewRound_organizationId_fkey/);
  assert.match(migration, /AIExaminerReviewDecision_organizationId_fkey/);
});

test("AI Examiner review-round routes enforce independence, masking and gated finalization", async () => {
  const routes = await readFile(new URL("./ai-examiner.ts", import.meta.url), "utf8");

  assert.match(routes, /router\.post\("\/evaluations\/:evaluationId\/review-rounds"/);
  assert.match(routes, /AI_EXAMINER_INDEPENDENT_REVIEWER_REQUIRED/);
  assert.match(routes, /AI_EXAMINER_MODERATOR_INDEPENDENCE_REQUIRED/);
  assert.match(routes, /AI_EXAMINER_SOURCE_IDENTITY_MASK_REQUIRED/);
  assert.match(routes, /round\.reviewerId !== req\.auth!\.userId/);
  assert.match(routes, /AI_EXAMINER_REVIEW_POLICY_INCOMPLETE/);
  assert.match(routes, /assessAIExaminerReviewCompletion/);
});

test("review-round mutations are organization scoped", async () => {
  const routes = await readFile(new URL("./ai-examiner.ts", import.meta.url), "utf8");

  assert.match(routes, /aIExaminerReviewRound\.findFirst\(\{\s*where: \{ id: roundId, organizationId: req\.auth!\.organizationId \}/);
  assert.match(routes, /organizationId: req\.auth!\.organizationId,\s*reviewRoundId: round\.id/);
  assert.match(routes, /AI_EXAMINER_REVIEW_ROUND_ASSIGNED/);
  assert.match(routes, /AI_EXAMINER_REVIEW_ROUND_SUBMITTED/);
});
