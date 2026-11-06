import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./admin-academic-sessions.ts", import.meta.url), "utf8");

function section(startNeedle: string, endNeedle: string) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, "expected academic-session route found");
  return source.slice(start, end);
}

test("branch manager academic-session aggregate selector binds every relation to assigned branches", () => {
  const helper = section("async function countsForReader", "const router=Router()");
  assert.match(helper, /Role\.BRANCH_ADMIN/);
  assert.match(helper, /prisma\.branchUser\.findMany/);
  assert.match(helper, /organizationId:req\.auth!\.organizationId,userId:req\.auth!\.userId/);
  assert.match(helper, /const where=\{branchId:\{in:branchIds\}\}/);
  for (const relation of ["batches", "students", "examinations", "timetables", "teacherAllocations"]) {
    assert.match(helper, new RegExp(`${relation}:\\{where\\}`));
  }
  assert.match(helper, /satisfies Prisma\.AcademicSessionInclude/);
});

test("academic-session list and detail apply scoped counts, while referenced-delete remains globally safe", () => {
  const list = section('router.get("/academic-sessions",', 'router.get("/academic-sessions/current",');
  const detail = section('router.get("/academic-sessions/:id",', 'router.post("/academic-sessions",');
  assert.match(list, /include:await countsForReader\(req\)/);
  assert.match(detail, /include:await countsForReader\(req\)/);
  const deletion = section('router.delete("/academic-sessions/:id",', "export default router;");
  assert.match(deletion, /_count:\{select:\{batches:true,students:true,examinations:true,timetables:true,teacherAllocations:true\}\}/);
  assert.doesNotMatch(deletion, /include:await countsForReader/);
});
