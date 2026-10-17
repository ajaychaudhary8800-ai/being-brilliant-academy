import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("./admin-timetables.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../../../web/app/admin/timetables/page.tsx", import.meta.url), "utf8");
const weekly = await readFile(new URL("../../../web/components/weekly-timetable-dialog.tsx", import.meta.url), "utf8");

test("weekly timetable API supports preview and atomic save, with server-side revalidation", () => {
  assert.match(route, /router\.post\("\/timetables\/weekly\/preview"/);
  assert.match(route, /router\.post\("\/timetables\/weekly"/);
  assert.match(route, /validateWeeklyTimetableEntries\(entries\)/);
  assert.match(route, /await lockTimetableBranch\(tx, entries\[0\]\.branchId\)/);
  assert.match(route, /const plan = await checkWeek\(req, entries, tx\)/);
  assert.match(route, /isolationLevel: Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(route, /await tx\.timetable\.create\(/);
  assert.match(route, /await tx\.auditLog\.create\(/);
  assert.match(route, /INSTITUTION_BRANCH_FORBIDDEN/);
});
test("weekly preview checks teacher, classroom, section and configured bells for each day", () => {
  assert.match(route, /await validate\(entry, undefined, db\)/);
  assert.match(route, /BATCH_SCHEDULE_CONFLICT/);
  assert.match(route, /TEACHER_SCHEDULE_CONFLICT/);
  assert.match(route, /CLASSROOM_SCHEDULE_CONFLICT/);
  assert.match(route, /INVALID_CONFIGURED_PERIOD/);
  assert.match(route, /weeklyAllocation: allocation\?\.weeklyPeriods \?\? null/);
  assert.match(route, /TIMETABLE_SLOT_EXISTS/);
});
test("admin timetable page offers both one-off and weekly scheduling", () => {
  assert.match(page, /Add Single Period/);
  assert.match(page, /Add Weekly Schedule/);
  assert.match(page, /<WeeklyTimetableDialog options=\{opts\}/);
  assert.match(weekly, /Mon–Sat \(6 days\)/);
  assert.match(weekly, /Mon–Fri \(5 days\)/);
  assert.match(weekly, /Preview \{sortedDays\.length\} Periods/);
  assert.match(weekly, /Save All \{preview\.count\} Periods/);
  assert.match(weekly, /getAccessToken/);
  assert.match(weekly, /configured teaching period/i);
});
