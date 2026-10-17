import assert from "node:assert/strict";
import test from "node:test";
import { validateWeeklyTimetableEntries } from "./timetable-weekly.js";

const entry = {
  branchId: "school", courseId: "class1", batchId: "sectionA", subjectId: "english",
  teacherId: "teacher", classroomId: "room1", academicSession: "2026-27",
  day: "MONDAY", periodNumber: 2, startTime: "09:40", endTime: "10:20",
};

test("one weekly schedule can assign English Monday to Saturday in one action", () => {
  const rows = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"].map(day => ({ ...entry, day }));
  assert.equal(validateWeeklyTimetableEntries(rows).length, 6);
});
test("GK can be taught Monday/Wednesday and Computer Tuesday/Thursday", () => {
  assert.deepEqual(validateWeeklyTimetableEntries([
    { ...entry, subjectId: "gk", day: "MONDAY" }, { ...entry, subjectId: "gk", day: "WEDNESDAY" },
  ]).map(x => x.day), ["MONDAY", "WEDNESDAY"]);
  assert.deepEqual(validateWeeklyTimetableEntries([
    { ...entry, subjectId: "computer", day: "TUESDAY" }, { ...entry, subjectId: "computer", day: "THURSDAY" },
  ]).map(x => x.day), ["TUESDAY", "THURSDAY"]);
});
test("each weekday can have different period numbers and time slots", () => {
  const rows = validateWeeklyTimetableEntries([
    entry, { ...entry, day: "FRIDAY", periodNumber: 5, startTime: "12:00", endTime: "12:40" },
  ]);
  assert.equal(rows[1].periodNumber, 5);
  assert.equal(rows[1].startTime, "12:00");
});
test("reject invalid weekly schedule size and duplicate days", () => {
  assert.throws(() => validateWeeklyTimetableEntries([]), /one and seven weekdays/);
  assert.throws(() => validateWeeklyTimetableEntries(Array.from({ length: 8 }, (_, i) => ({ ...entry, day: String(i) }))), /one and seven weekdays/);
  assert.throws(() => validateWeeklyTimetableEntries([entry, entry]), /each weekday only once/);
});
test("reject mixed teachers, sections, rooms, subjects or branches", () => {
  for (const key of ["branchId", "courseId", "batchId", "subjectId", "teacherId", "classroomId", "academicSession"] as const) {
    assert.throws(() => validateWeeklyTimetableEntries([entry, { ...entry, day: "TUESDAY", [key]: "other" }]), /one teacher, subject, section and classroom/);
  }
});
