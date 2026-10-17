import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const api = await readFile(new URL("./admin-school-timetables.ts", import.meta.url), "utf8");
const server = await readFile(new URL("../server.ts", import.meta.url), "utf8");
const ui = await readFile(new URL("../../../web/components/school-class-day-planner.tsx", import.meta.url), "utf8");
const page = await readFile(new URL("../../../web/app/admin/timetables/page.tsx", import.meta.url), "utf8");

test("school class-day planner is school-only and coaching timetable remains unchanged", () => {
  assert.match(api, /groupLabelType !== "SECTION"/);
  assert.match(api, /organizationId: orgId/);
  assert.match(api, /Role.BRANCH_ADMIN/);
  assert.match(api, /branchUser.findFirst/);
  assert.match(server, /app.use\("\/api\/v1\/admin", adminSchoolTimetables\)/);
  assert.match(page, /terms.mode === "SCHOOL"/);
  assert.match(page, /Add Weekly Schedule/);
  assert.match(page, /SchoolClassDayPlanner/);
});
test("school day API validates active section allocations, classrooms and configured bell periods", () => {
  assert.match(api, /status: "ACTIVE", branch: \{ organizationId: orgId, isActive: true \}/);
  assert.match(api, /teacherAllocation.findMany/);
  assert.match(api, /subject: \{ status: "ACTIVE", courses:/);
  assert.match(api, /NOT_A_TEACHING_PERIOD/);
  assert.match(api, /SUBJECT_NOT_ALLOCATED/);
  assert.match(api, /INVALID_CLASSROOM/);
  assert.match(api, /DUPLICATE_DAY_PERIOD/);
});
test("school day atomic save is previewed and revalidated under serialized branch lock", () => {
  assert.match(api, /"\/timetables\/school-day\/preview"/);
  assert.match(api, /"\/timetables\/school-day"/);
  assert.match(api, /Prisma.TransactionIsolationLevel.Serializable/);
  assert.match(api, /pg_advisory_xact_lock/);
  assert.match(api, /const checked = await plan\(req, parsed.batchId, parsed.day, parsed.entries, tx\)/);
  assert.match(api, /SCHOOL_DAY_CONFLICT/);
  assert.match(api, /await tx.auditLog.create/);
});
test("schedule uses global breaks and allocated teacher-subject pairs, not fake lunch subjects", () => {
  assert.match(ui, /period.type === "BREAK"/);
  assert.match(ui, /Whole-school non-teaching block/);
  assert.match(ui, /Academic Operations → Period Configuration/);
  assert.match(ui, /teacher-subject allocations/);
  assert.match(ui, /Preview/);
  assert.match(ui, /Save School Day/);
  assert.doesNotMatch(api, /subject.create/);
});
