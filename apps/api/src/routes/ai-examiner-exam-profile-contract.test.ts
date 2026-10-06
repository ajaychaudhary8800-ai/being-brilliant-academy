import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Ranpal AI Examiner exam profiles are versioned, tenant-scoped and snapshotted onto examinations", async () => {
  const [schema, migration, route, profileLib] = await Promise.all([
    readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../../prisma/migrations/20260930054500_ai_examiner_exam_profiles/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("ai-examiner.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai-examiner-exam-profile.ts", import.meta.url), "utf8"),
  ]);

  assert.match(schema, /model AIExaminerExamProfile/);
  assert.match(schema, /organizationId String/);
  assert.match(schema, /branchId\s+String\?/);
  assert.match(schema, /@@unique\(\[organizationId, code, version\]\)/);
  assert.match(schema, /aiExaminerExamProfileSnapshot Json\?/);
  assert.match(schema, /AIExaminerExamProfileStatus/);

  assert.match(migration, /CREATE TABLE IF NOT EXISTS "AIExaminerExamProfile"/);
  assert.match(migration, /FOREIGN KEY \("organizationId"\) REFERENCES "Organization"/);
  assert.match(migration, /FOREIGN KEY \("branchId"\) REFERENCES "Branch"/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "aiExaminerExamProfileSnapshot" JSONB/);

  assert.match(route, /router\.get\("\/exam-profiles"/);
  assert.match(route, /router\.post\("\/exam-profiles"/);
  assert.match(route, /router\.put\("\/exam-profiles\/:profileId"/);
  assert.match(route, /\/exam-profiles\/:profileId\/activate/);
  assert.match(route, /\/examinations\/:examinationId\/exam-profile/);
  assert.match(route, /AI_EXAMINER_PROFILE_BRANCH_REQUIRED/);
  assert.match(route, /AI_EXAMINER_PROFILE_IMMUTABLE/);
  assert.match(route, /aiExaminerExamProfileSnapshot: profileJson\(snapshot\)/);
  assert.match(route, /AI_EXAMINER_EXAM_PROFILE_ASSIGNED/);

  assert.match(profileLib, /JEE_MAIN/);
  assert.match(profileLib, /JEE_ADVANCED/);
  assert.match(profileLib, /NEET/);
  assert.match(profileLib, /NDA/);
  assert.match(profileLib, /CUET/);
  assert.match(profileLib, /source: "QUESTION"/);
  assert.match(profileLib, /source: "SECTION"/);
  assert.match(profileLib, /source: "PROFILE"/);
  assert.match(profileLib, /source: "DEFAULT"/);
});
