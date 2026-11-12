import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ai-examiner.ts", import.meta.url), "utf8");
const start = source.indexOf('router.get("/examinations",');
const end = source.indexOf('router.get("/examinations/:examinationId/readiness"', start);
assert.ok(start >= 0 && end > start, "AI Examiner examinations listing route must be present");
const listRoute = source.slice(start, end);

test("AI Examiner TEACHER missing same-tenant profile fails closed before querying examinations", () => {
  assert.match(listRoute, /const isTeacher = req\.auth!\.role === Role\.TEACHER/);
  assert.match(listRoute, /prisma\.teacherProfile\.findFirst\(\{ where: \{ organizationId: req\.auth!\.organizationId, userId: req\.auth!\.userId, user: \{ isActive: true \} \}/);
  const deny = listRoute.indexOf("if (isTeacher && !teacher) return res.json({ data: [] })");
  const query = listRoute.indexOf("prisma.examination.findMany(");
  assert.ok(deny >= 0 && query > deny, "Missing TeacherProfile must never query unscoped exams");
});

test("AI Examiner TEACHER always uses its exact TeacherProfile ID, never optional filter", () => {
  assert.match(listRoute, /\.\.\.\(isTeacher \? \{ teacherId: teacher!\.id \} : \{\}\)/);
  assert.doesNotMatch(listRoute, /\.\.\.\(teacher \? \{ teacherId: teacher\.id \} : \{\}\)/);
  assert.match(listRoute, /organizationId: req\.auth!\.organizationId/);
  assert.match(listRoute, /branchId: \{ in: branchIds \}/);
});

test("AI Examiner exam details still enforce manager, effective allocation and tenant scope", () => {
  const managerStart = source.indexOf("async function examinationForManager");
  const managerEnd = source.indexOf("async function publicationAuditTime(", managerStart);
  const manager = source.slice(managerStart, managerEnd);
  assert.match(manager, /assertExaminationManager\(req\.auth!\.role, req\.auth!\.userId, exam\.teacher\.userId\)/);
  assert.match(manager, /organizationId: req\.auth!\.organizationId/);
  assert.match(manager, /EXAMINATION_ALLOCATION_REQUIRED/);
  assert.match(manager, /await branchAccess\(req, exam\.branchId\)/);
});
