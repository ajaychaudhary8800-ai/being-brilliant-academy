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

test("timetable tenant boundaries protect the options, read, export, and single-write paths", () => {
  assert.match(route, /async function access\(req:AuthRequest,id:string,db:Prisma\.TransactionClient\|typeof prisma=prisma\)/);
  assert.match(route, /db\.branch\.findFirst\(\{where:\{id,organizationId:req\.auth!\.organizationId\}/);
  assert.match(route, /INSTITUTION_BRANCH_FORBIDDEN/);
  const options = route.split('router.get("/timetables/options",')[1]?.split('router.get("/timetables/dashboard",')[0];
  assert.ok(options);
  assert.match(options, /where=\{organizationId:req\.auth!\.organizationId,isActive:true/);
  assert.match(options, /prisma\.batch\.findMany\(\{where:\{organizationId:req\.auth!\.organizationId/);
  assert.match(options, /prisma\.classroom\.findMany\(\{where:\{isActive:true,branch:\{organizationId:req\.auth!\.organizationId\}/);
  assert.match(route, /prisma\.timetable\.findMany\(\{where:\{branch:\{organizationId:req\.auth!\.organizationId\}/);
  assert.match(route, /const where=\{branch:\{organizationId:req\.auth!\.organizationId\}/);
  assert.match(route, /return tx\.timetable\.create\(\{data:\{\.\.\.rest,\.\.\.t,organizationId:req\.auth!\.organizationId\}/);
});

test("single period edits and archived reactivation are serializable and recheck conflicts", () => {
  const edit = route.split('router.patch("/timetables/:id",')[1]?.split('router.patch("/timetables/:id/status",')[0];
  assert.ok(edit);
  assert.match(edit, /await access\(req,old\.branchId,tx\)/);
  assert.match(edit, /if\(p\.branchId\)await access\(req,p\.branchId,tx\)/);
  assert.match(edit, /const branches=\[\.\.\.new Set\(\[old\.branchId,p\.branchId\?\?old\.branchId\]\)\]\.sort\(\)/);
  assert.match(edit, /await lockTimetableBranch\(tx,branchId\)/);
  assert.match(edit, /await validate\(d,old\.id,tx\)/);
  assert.match(edit, /TransactionIsolationLevel\.Serializable/);
  const status = route.split('router.patch("/timetables/:id/status",')[1]?.split('router.delete("/timetables/:id",')[0];
  assert.ok(status);
  assert.match(status, /await lockTimetableBranch\(tx,old\.branchId\)/);
  assert.match(status, /old\.status===TimetableStatus\.ARCHIVED && status!==TimetableStatus\.ARCHIVED/);
  assert.match(status, /\},old\.id,tx\)/);
  assert.match(status, /TransactionIsolationLevel\.Serializable/);
});
