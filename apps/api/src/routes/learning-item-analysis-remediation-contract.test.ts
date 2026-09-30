import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("item analysis is manager-only, tenant-scoped and uses evaluated attempt data", async () => {
  const routes = await readFile(new URL("./learning-ecosystem.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.get("/learning/tests/:id/item-analysis"');
  assert.ok(start >= 0);
  const section = routes.slice(start, start + 7000);

  assert.match(section, /managers/);
  assert.match(section, /organizationId: req\.auth!\.organizationId/);
  assert.match(section, /learningResourceWhere\(actor\)/);
  assert.match(section, /LearningAttemptStatus\.EVALUATED/);
  assert.match(section, /calculateLearningTestPsychometrics/);
  assert.match(section, /ITEM_ANALYSIS/);
});

test("remediation derives context from frozen question snapshots", async () => {
  const routes = await readFile(new URL("./learning-ecosystem.ts", import.meta.url), "utf8");

  assert.match(routes, /function remediationQuestionContext/);
  assert.match(routes, /questionSnapshot/);
  assert.match(routes, /snapshot\.learningOutcomes/);
  assert.match(routes, /snapshot\.chapter/);
  assert.match(routes, /snapshot\.topic/);
});

test("remediation only uses published non-archived study material in the same course and subject", async () => {
  const routes = await readFile(new URL("./learning-ecosystem.ts", import.meta.url), "utf8");
  const start = routes.indexOf("async function regenerateLearningAttemptRemediation");
  const end = routes.indexOf('router.post("/learning/tests/:id/start"', start);
  assert.ok(start >= 0 && end > start);
  const section = routes.slice(start, end);

  assert.match(section, /organizationId: input\.organizationId/);
  assert.match(section, /status: LearningStatus\.PUBLISHED/);
  assert.match(section, /isArchived: false/);
  assert.match(section, /courseId: attempt\.test\.courseId/);
  assert.match(section, /attempt\.test\.subjectId \? \{ subjectId: attempt\.test\.subjectId \} : \{\}/);
});

test("remediation refreshes only open recommendations belonging to the evaluated attempt", async () => {
  const routes = await readFile(new URL("./learning-ecosystem.ts", import.meta.url), "utf8");
  const start = routes.indexOf("async function regenerateLearningAttemptRemediation");
  const end = routes.indexOf('router.post("/learning/tests/:id/start"', start);
  const section = routes.slice(start, end);

  assert.match(section, /kind: "REMEDIAL"/);
  assert.match(section, /entityType: "LearningTestAttempt"/);
  assert.match(section, /entityId: attempt\.id/);
  assert.match(section, /completedAt: null/);
  assert.match(section, /learningRecommendation\.createMany/);
});

test("students and parents can regenerate remediation only for owned or linked attempts", async () => {
  const routes = await readFile(new URL("./learning-ecosystem.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.post("/learning/attempts/:id/remediation"');
  assert.ok(start >= 0);
  const section = routes.slice(start, start + 3500);

  assert.match(section, /allow\(Role\.STUDENT, Role\.PARENT\)/);
  assert.match(section, /organizationId: req\.auth!\.organizationId/);
  assert.match(section, /await assertStudentTargetAccess\(actor, attempt\.studentId\)/);
  assert.match(section, /learningResourceWhere\(actor\)/);
  assert.match(section, /GENERATE_REMEDIATION/);
});

test("attempt finalization triggers best-effort remediation without rolling back marks", async () => {
  const routes = await readFile(new URL("./learning-ecosystem.ts", import.meta.url), "utf8");
  assert.match(routes, /try \{ await regenerateLearningAttemptRemediation\(/);
  assert.match(routes, /Result finalization must not be rolled back by optional recommendation generation/);
});
