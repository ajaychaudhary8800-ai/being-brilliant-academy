import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { examinationCodeConflict, isExaminationCodeConflict } from "./examination-uniqueness.js";

const scopedCodeKey = (organizationId: string, code: string) => `${organizationId}\u0000${code}`;

test("the chosen business key permits cross-tenant codes and repeated exam contexts with distinct codes", () => {
  assert.notEqual(scopedCodeKey("org-a", "UT1"), scopedCodeKey("org-b", "UT1"));
  assert.equal(scopedCodeKey("org-a", "UT1"), scopedCodeKey("org-a", "UT1"));

  const repeatedUnitTests = ["UT1", "UT2", "UT3"].map(code => scopedCodeKey("org-a", code));
  assert.equal(new Set(repeatedUnitTests).size, 3);

  assert.equal(
    scopedCodeKey("org-a", "UT1"),
    scopedCodeKey("org-a", "UT1"),
    "the same code remains reserved across batches and subjects inside one organization",
  );
  assert.notEqual(scopedCodeKey("org-a", "PHY-UT1"), scopedCodeKey("org-a", "CHEM-UT1"));
});

test("organization-scoped examination code conflicts are recognized without matching unrelated unique errors", () => {
  assert.equal(isExaminationCodeConflict({ code: "P2002", meta: { target: ["organizationId", "code"] } }), true);
  assert.equal(isExaminationCodeConflict({ code: "P2002", meta: { target: "Examination_organizationId_code_key" } }), true);
  assert.equal(isExaminationCodeConflict({ code: "P2002", meta: { target: ["batchId", "subjectId"] } }), false);
  assert.equal(isExaminationCodeConflict({ code: "P2034" }), false);

  const error = examinationCodeConflict();
  assert.equal(error.status, 409);
  assert.equal(error.code, "EXAMINATION_CODE_EXISTS");
  assert.match(error.message, /this organization/);
});

test("schema scopes examination codes to organizations and allows repeated examination contexts", async () => {
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const model = schema.slice(schema.indexOf("model Examination {"), schema.indexOf("model ExaminationResult {"));

  assert.match(model, /code\s+String\s*\r?\n/);
  assert.doesNotMatch(model, /code\s+String\s+@unique/);
  assert.match(model, /@@unique\(\[organizationId, code\]\)/);
  assert.doesNotMatch(model, /@@unique\(\[batchId, subjectId, type, academicSession\]\)/);
  assert.match(model, /id\s+String\s+@id/);
});

test("migration only adds tenant code uniqueness and removes the two obsolete indexes", async () => {
  const sql = await readFile(new URL("../../prisma/migrations/20260908120000_scope_examination_code_to_organization/migration.sql", import.meta.url), "utf8");

  assert.match(sql, /CREATE UNIQUE INDEX "Examination_organizationId_code_key"[^]*\("organizationId", "code"\)/);
  assert.match(sql, /DROP INDEX "Examination_code_key"/);
  assert.match(sql, /DROP INDEX "Examination_batchId_subjectId_type_academicSession_key"/);
  assert.match(sql, /BEGIN;[^]*COMMIT;/);
  assert.equal((sql.match(/CREATE UNIQUE INDEX/g) ?? []).length, 1);
  assert.equal((sql.match(/DROP INDEX/g) ?? []).length, 2);
  assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN)|DELETE\s+FROM|TRUNCATE|UPDATE\s+"Examination"|ALTER\s+TABLE|_prisma_migrations/i);
});

test("create and edit normalize codes, preflight within the tenant, and map the race-safe database conflict", async () => {
  const route = await readFile(new URL("../routes/admin-examinations.ts", import.meta.url), "utf8");

  assert.match(route, /code: z\.string\(\)\.trim\(\)\.toUpperCase\(\)/);
  assert.match(route, /organizationId,\s*\r?\n\s*code: \{ equals: data\.code, mode: "insensitive" \}/);
  assert.match(route, /exclude \? \{ id: \{ not: exclude \} \}/);
  assert.equal((route.match(/isExaminationCodeConflict\(error\)/g) ?? []).length, 2);
  assert.doesNotMatch(route, /Exam Code or Batch\/Subject\/Exam Type already exists/);
  assert.doesNotMatch(route, /DUPLICATE_EXAMINATION/);
});

test("repeated exam identity remains ID-based across papers, submissions, results, and portals", async () => {
  const [admin, workflow, portals] = await Promise.all([
    readFile(new URL("../routes/admin-examinations.ts", import.meta.url), "utf8"),
    readFile(new URL("../routes/examination-workflow.ts", import.meta.url), "utf8"),
    readFile(new URL("../routes/portals.ts", import.meta.url), "utf8"),
  ]);

  assert.match(admin, /where: \{ id: String\(req\.params\.id\) \}/);
  assert.match(workflow, /where: \{ id: examinationId, organizationId: req\.auth!\.organizationId \}/);
  assert.match(workflow, /where: \{ examinationId: exam\.id, organizationId: req\.auth!\.organizationId \}/);
  assert.match(workflow, /examinationId_studentId: \{ examinationId: exam\.id, studentId: student\.id \}/);
  assert.match(portals, /results: \{ where: \{ studentId: student\.id \}/);
  for (const source of [admin, workflow, portals]) {
    assert.doesNotMatch(source, /examination\.findUnique\(\{\s*where:\s*\{\s*code:/);
    assert.doesNotMatch(source, /examination\.findFirst\(\{\s*where:\s*\{\s*code:/);
  }
});

test("tenant, branch, question-paper, submission, and grading authorization remain explicit", async () => {
  const [admin, workflow, branchEnforcement] = await Promise.all([
    readFile(new URL("../routes/admin-examinations.ts", import.meta.url), "utf8"),
    readFile(new URL("../routes/examination-workflow.ts", import.meta.url), "utf8"),
    readFile(new URL("../routes/admin-examination-branch-enforcement.ts", import.meta.url), "utf8"),
  ]);

  assert.match(admin, /organizationId: req\.auth!\.organizationId/);
  assert.match(admin, /await access\(req, old\.branchId\)/);
  assert.match(admin, /await access\(req, partial\.branchId\)/);
  assert.match(branchEnforcement, /branchUser\.findFirst/);
  assert.match(branchEnforcement, /BRANCH_FORBIDDEN/);
  assert.match(workflow, /assertStudentExaminationEligible\(student, exam\)/);
  assert.match(workflow, /assertExaminationManager\(req\.auth!\.role/);
  assert.match(workflow, /organizationId: req\.auth!\.organizationId/);
  assert.match(workflow, /assertEvaluationOpen/);
  assert.match(workflow, /TransactionIsolationLevel\.Serializable/);
});
