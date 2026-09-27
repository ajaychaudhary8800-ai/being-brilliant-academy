import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Ranpal AI Examiner foundation owns versioned rubrics and reviewable evaluation records", async () => {
  const [schema,migration,route,server,policy,page,sidebar,workflow,adminPage,teacherPage] = await Promise.all([
    readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../../prisma/migrations/20260927150000_ai_examiner_foundation/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("ai-examiner.ts", import.meta.url), "utf8"),
    readFile(new URL("../server.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai-examiner-policy.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../web/components/ai-examiner-foundation.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../web/components/sidebar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../web/components/examination-workflow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../web/app/admin/ai-examiner/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../web/app/teacher/ai-examiner/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(schema, /model AIExaminerRubric/);
  assert.match(schema, /model AIExaminerEvaluation/);
  assert.match(schema, /model AIExaminerQuestionEvaluation/);
  assert.match(schema, /@@unique\(\[examinationId, version\]\)/);
  assert.match(schema, /@@unique\(\[answerSheetId, revision\]\)/);
  assert.match(schema, /reviewRequired\s+Boolean\s+@default\(true\)/);

  assert.match(migration, /CREATE TYPE "AIExaminerRubricStatus"/);
  assert.match(migration, /CREATE TYPE "AIExaminerEvaluationStatus"/);
  assert.match(migration, /CREATE TABLE "AIExaminerRubric"/);
  assert.match(migration, /CREATE TABLE "AIExaminerEvaluation"/);
  assert.match(migration, /CREATE TABLE "AIExaminerQuestionEvaluation"/);

  assert.match(route, /\/examinations\/:examinationId\/readiness/);
  assert.match(route, /\/examinations\/:examinationId\/rubric/);
  assert.match(route, /\/rubrics\/:rubricId\/activate/);
  assert.match(route, /\/answer-sheets\/:answerSheetId\/evaluations/);
  assert.match(route, /requireCommercialFeature\("examinations"\)/);
  assert.match(route, /evaluationExecutionAvailable: false/);
  assert.match(route, /providerConfigured: Boolean\(env\.AI_PROVIDER_URL && env\.AI_API_KEY\)/);

  assert.match(policy, /AI_EXAMINER_RUBRIC_MARKS_MISMATCH/);
  assert.match(policy, /AI_EXAMINER_ACTIVE_RUBRIC_REQUIRED/);
  assert.match(policy, /aiExaminerConfidenceNeedsReview/);

  assert.match(server, /import aiExaminer from "\.\/routes\/ai-examiner\.js"/);
  assert.match(server, /app\.use\("\/api\/v1\/ai-examiner", aiExaminer\)/);

  assert.match(page, /RANPAL AI EXAMINER/);
  assert.match(page, /Marking Rubric/);
  assert.match(page, /General evaluation instructions/);
  assert.match(page, /Model answer \/ solution/);
  assert.match(page, /Activate Draft/);
  assert.match(page, /evaluationExecutionAvailable/);
  assert.match(sidebar, /Ranpal AI Examiner/);
  assert.match(sidebar, /\/admin\/ai-examiner/);
  assert.match(workflow, /\/teacher\/ai-examiner/);
  assert.match(adminPage, /SUPER_ADMIN/);
  assert.match(adminPage, /BRANCH_ADMIN/);
  assert.match(teacherPage, /TEACHER/);
});
