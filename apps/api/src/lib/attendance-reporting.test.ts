import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceStatus } from "@prisma/client";
import { averageAttendancePercentage, groupAttendanceRecords, summarizeAttendance } from "./attendance-reporting.js";

test("attendance percentage counts Present and Late as attended days", () => {
  const counts = summarizeAttendance([
    { status: AttendanceStatus.PRESENT },
    { status: AttendanceStatus.LATE },
    { status: AttendanceStatus.ABSENT },
    { status: AttendanceStatus.FULL_DAY_LEAVE },
  ]);
  assert.equal(counts.total, 4);
  assert.equal(counts.percentage, 50);
  assert.equal(counts.fullDayLeave, 1);
  assert.equal(counts.absent, 1);
});

test("half-day and short leave remain distinct and are not counted as absence", () => {
  const counts = summarizeAttendance([
    { status: AttendanceStatus.HALF_DAY_LEAVE },
    { status: AttendanceStatus.SHORT_LEAVE },
    { status: AttendanceStatus.LEAVE },
  ]);
  assert.equal(counts.halfDayLeave, 1);
  assert.equal(counts.shortLeave, 1);
  assert.equal(counts.leave, 1);
  assert.equal(counts.absent, 0);
  assert.equal(counts.percentage, 0);
});

test("student and teacher report grouping is person-scoped and empty reports are stable", () => {
  const records = [
    { date: new Date("2026-09-01T00:00:00Z"), status: AttendanceStatus.PRESENT, person: { id: "student", name: "Student", identifier: "S-1", branch: "Main", course: "Course", batch: "Batch" } },
    { date: new Date("2026-09-02T00:00:00Z"), status: AttendanceStatus.ABSENT, person: { id: "student", name: "Student", identifier: "S-1", branch: "Main", course: "Course", batch: "Batch" } },
    { date: new Date("2026-09-01T00:00:00Z"), status: AttendanceStatus.LATE, person: { id: "teacher", name: "Teacher", identifier: "T-1", branch: "Main" } },
  ];
  const grouped = groupAttendanceRecords(records);
  assert.equal(grouped.length, 2);
  assert.equal(grouped.find(item => item.person.id === "student")?.counts.total, 2);
  assert.equal(grouped.find(item => item.person.id === "teacher")?.counts.percentage, 100);
  assert.deepEqual(summarizeAttendance([]), { present: 0, absent: 0, late: 0, fullDayLeave: 0, halfDayLeave: 0, shortLeave: 0, leave: 0, excused: 0, total: 0, percentage: 0 });
  assert.equal(averageAttendancePercentage([]), 0);
});
