import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("regrade workflow persists tenant-scoped requests and immutable result revisions", async () => {
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = await readFile(new URL("../../prisma/migrations/20260930074500_ai_examiner_regrade_workflow/migration.sql", import.meta.url), "utf8");

  assert.match(schema, /model AIExaminerRegradeRequest \{/);
  assert.match(schema, /model AIExaminerResultRevision \{/);
  assert.match(schema, /regradeRequestId\s+String\s+@unique/);
  assert.match(schema, /@@unique\(\[resultId, revision\]\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "AIExaminerRegradeRequest"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "AIExaminerResultRevision"/);
  assert.match(migration, /AIExaminerRegradeRequest_organizationId_fkey/);
  assert.match(migration, /AIExaminerResultRevision_organizationId_fkey/);
});

test("regrade request creation is gated by publication, policy, window and request limits", async () => {
  const routes = await readFile(new URL("./ai-examiner.ts", import.meta.url), "utf8");

  assert.match(routes, /router\.post\("\/answer-sheets\/:answerSheetId\/regrade-requests"/);
  assert.match(routes, /ExaminationStatus\.RESULTS_PUBLISHED/);
  assert.match(routes, /regradePolicyFromExamSnapshot/);
  assert.match(routes, /aiExaminerRegradeWindow/);
  assert.match(routes, /AI_EXAMINER_REGRADE_DISABLED/);
  assert.match(routes, /AI_EXAMINER_REGRADE_LIMIT_REACHED/);
  assert.match(routes, /normalizeAIExaminerRegradeQuestionKeys/);
  assert.match(routes, /AI_EXAMINER_REGRADE_ALREADY_OPEN/);
});

test("regrade authorization separates reviewer work from administrative decisions", async () => {
  const routes = await readFile(new URL("./ai-examiner.ts", import.meta.url), "utf8");

  assert.match(routes, /function requireRegradeAdmin/);
  assert.match(routes, /router\.post\("\/regrade-requests\/:requestId\/decision"/);
  assert.match(routes, /router\.post\("\/regrade-requests\/:requestId\/assign"/);
  assert.match(routes, /AI_EXAMINER_REGRADE_INDEPENDENT_REVIEWER_REQUIRED/);
  assert.match(routes, /router\.post\("\/regrade-requests\/:requestId\/review"/);
  assert.match(routes, /request\.reviewRound\.reviewerId !== req\.auth!\.userId/);
  assert.match(routes, /AI_EXAMINER_REGRADE_REVIEW_FORBIDDEN/);
  assert.match(routes, /AI_EXAMINER_REGRADE_RESOLVER_INDEPENDENCE_REQUIRED/);
});

test("question-set regrade preserves unchallenged final marks and revises only configured scope", async () => {
  const routes = await readFile(new URL("./ai-examiner.ts", import.meta.url), "utf8");

  assert.match(routes, /request\.scope === AIExaminerRegradeScope\.QUESTION_SET/);
  assert.match(routes, /request\.questionKeys/);
  assert.match(routes, /const existing = question\.finalMarks == null \? null : Number\(question\.finalMarks\)/);
  assert.match(routes, /revisedTotal \+= existing/);
  assert.match(routes, /AI_EXAMINER_REGRADE_REVIEW_INCOMPLETE/);
});

test("regrade resolution snapshots before and after state and recalculates published ranks", async () => {
  const routes = await readFile(new URL("./ai-examiner.ts", import.meta.url), "utf8");

  assert.match(routes, /resultRevisionSnapshot\(currentResult\)/);
  assert.match(routes, /recomputePublishedRanks\(tx, req\.auth!\.organizationId, exam\.id\)/);
  assert.match(routes, /resultRevisionSnapshot\(updatedResult\)/);
  assert.match(routes, /aIExaminerResultRevision\.create/);
  assert.match(routes, /AI_EXAMINER_REGRADE_RESOLVED/);
  assert.match(routes, /Prisma\.TransactionIsolationLevel\.Serializable/);
});

test("result revision history is exposed only through examination-manager access", async () => {
  const routes = await readFile(new URL("./ai-examiner.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.get("/results/:resultId/revisions"');
  assert.ok(start >= 0);
  const section = routes.slice(start);
  assert.match(section, /await examinationForManager\(req, result\.examinationId\)/);
  assert.match(section, /aIExaminerResultRevision\.findMany/);
});


test("appeal reviewer workspace is scoped and cannot use the generic review submit path", async () => {
  const routes = await readFile(new URL("./ai-examiner.ts", import.meta.url), "utf8");

  assert.match(routes, /round\.regradeRequest\?\.scope === AIExaminerRegradeScope\.QUESTION_SET/);
  assert.match(routes, /round\.regradeRequest\?\.scope === AIExaminerRegradeScope\.CLERICAL_CHECK/);
  assert.match(routes, /appealKeys\.has\(question\.questionKey\.toLowerCase\(\)\)/);
  assert.match(routes, /AI_EXAMINER_APPEAL_USE_REGRADE_REVIEW/);
  assert.match(routes, /priorMarksVisible: false/);
});


test("resolved question-level regrades update canonical question marks and preserve question snapshots", async () => {
  const routes = await readFile(new URL("./ai-examiner.ts", import.meta.url), "utf8");

  assert.match(routes, /questions: request\.evaluation\.questions\.map\(question => \(\{/);
  assert.match(routes, /aIExaminerQuestionEvaluation\.update\(\{/);
  assert.match(routes, /finalMarks: Number\(decision\.awardedMarks\)/);
  assert.match(routes, /reviewRequired: false/);
  assert.match(routes, /questions: updatedQuestions\.map\(question => \(\{/);
  assert.match(routes, /beforeSnapshot: profileJson\(beforeSnapshot\)/);
  assert.match(routes, /afterSnapshot: profileJson\(afterSnapshot\)/);
});

test("published rank recomputation returns and audits every rank impact", async () => {
  const routes = await readFile(new URL("./ai-examiner.ts", import.meta.url), "utf8");

  assert.match(routes, /const impacts: Array<\{ resultId: string; beforeRank: number \| null; afterRank: number \| null \}>/);
  assert.match(routes, /impacts\.push\(\{ resultId: row\.id, beforeRank: row\.rank, afterRank: rank \}\)/);
  assert.match(routes, /const rankImpacts = await recomputePublishedRanks/);
  assert.match(routes, /rankImpacts,/);
  assert.match(routes, /revisedQuestionKeys:/);
});
