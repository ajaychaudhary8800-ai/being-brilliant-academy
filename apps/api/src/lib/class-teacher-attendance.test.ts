import assert from "node:assert/strict";
import test from "node:test";
import { teacherCanMarkDailyAttendance } from "./class-teacher-attendance.js";

test("school daily attendance belongs exclusively to assigned Class Teacher", () => {
  assert.equal(teacherCanMarkDailyAttendance("SECTION", "teacher-A", "teacher-A", false), true);
  assert.equal(teacherCanMarkDailyAttendance("SECTION", "teacher-A", "teacher-B", true), false);
  assert.equal(teacherCanMarkDailyAttendance("SECTION", null, "teacher-B", true), false);
  assert.equal(teacherCanMarkDailyAttendance("SECTION", "teacher-A", null, true), false);
});
test("coaching keeps allocation or timetable permission", () => {
  assert.equal(teacherCanMarkDailyAttendance("BATCH", null, "teacher-B", true), true);
  assert.equal(teacherCanMarkDailyAttendance("BATCH", "teacher-A", "teacher-B", false), false);
});
