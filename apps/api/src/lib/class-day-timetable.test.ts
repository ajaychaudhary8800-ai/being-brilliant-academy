import assert from "node:assert/strict";
import test from "node:test";
import { validateClassDayEntries, type SchoolDayEntry } from "./class-day-timetable.js";

const period = (overrides: Partial<SchoolDayEntry> = {}): SchoolDayEntry => ({
  branchId: "branch1", courseId: "class8", batchId: "sectionA",
  academicSession: "2026-27", day: "MONDAY", periodNumber: 1,
  startTime: "08:30", endTime: "09:10", status: "ACTIVE", ...overrides,
});

test("class-day periods are sorted chronologically and allowed to contain gaps for breaks", () => {
  const result = validateClassDayEntries([
    period({ periodNumber: 3, startTime: "10:00", endTime: "10:40" }),
    period({ periodNumber: 1 }),
  ]);
  assert.deepEqual(result.map(row => row.periodNumber), [1, 3]);
});

test("reject duplicate periods", () => {
  assert.throws(() => validateClassDayEntries([period(), period()]), /same period number/);
});
test("reject teacher period overlap within a class day", () => {
  assert.throws(() => validateClassDayEntries([
    period(), period({ periodNumber: 2, startTime: "09:00", endTime: "09:40" }),
  ]), /non-overlapping/);
});
test("reject cross-class and cross-weekday payloads", () => {
  assert.throws(() => validateClassDayEntries([period(), period({ batchId: "sectionB", periodNumber: 2, startTime: "09:10" })]), /same class/);
  assert.throws(() => validateClassDayEntries([period(), period({ day: "TUESDAY", periodNumber: 2, startTime: "09:10" })]), /same class/);
});
test("reject inactive and empty day payloads", () => {
  assert.throws(() => validateClassDayEntries([]), /Select 1 to 50/);
  assert.throws(() => validateClassDayEntries([period({ status: "INACTIVE" })]), /active teaching/);
});
