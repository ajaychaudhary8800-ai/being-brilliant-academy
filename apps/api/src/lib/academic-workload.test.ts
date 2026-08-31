import assert from "node:assert/strict";
import test from "node:test";
import { TimetablePeriodType } from "@prisma/client";
import { rankSubstituteCandidates, summarizeSlots, timetableDay, weekDates } from "./academic-workload.js";

test("free periods are derived and breaks are not counted as availability", () => {
  const date = new Date("2026-08-25T00:00:00.000Z");
  const result = summarizeSlots(date, [1, 2, 3, 4, 5, 6, 7].map(periodNumber => ({ periodNumber, type: periodNumber === 4 ? TimetablePeriodType.BREAK : TimetablePeriodType.TEACHING })), [1, 2, 3], [5], [{ periodNumber: 6, type: "MEETING" }]);
  assert.deepEqual({ available: result.availablePeriods, regular: result.regularTeaching, substitution: result.substitution, duty: result.otherDuty, occupied: result.totalOccupied, free: result.freePeriods }, { available: 6, regular: 3, substitution: 1, duty: 1, occupied: 5, free: 1 });
  assert.equal(result.states.find(row => row.periodNumber === 7)?.state, "FREE");
});

test("different day configurations remain independent", () => {
  const monday = new Date("2026-08-24T00:00:00.000Z"), saturday = new Date("2026-08-29T00:00:00.000Z");
  assert.equal(summarizeSlots(monday, Array.from({ length: 8 }, (_, index) => ({ periodNumber: index + 1, type: TimetablePeriodType.TEACHING })), [1], [], []).availablePeriods, 8);
  assert.equal(summarizeSlots(saturday, Array.from({ length: 4 }, (_, index) => ({ periodNumber: index + 1, type: TimetablePeriodType.TEACHING })), [1], [], []).availablePeriods, 4);
  assert.equal(timetableDay(saturday), "SATURDAY"); assert.equal(weekDates(saturday).length, 7);
});

test("substitute ranking prioritizes subject qualification, then course familiarity and lighter workload", () => {
  const candidates = rankSubstituteCandidates([
    { name: "Neha", subjectQualified: false, courseFamiliar: false, todayLoad: 1 },
    { name: "Ajay", subjectQualified: true, courseFamiliar: true, todayLoad: 4 },
    { name: "Ravi", subjectQualified: true, courseFamiliar: true, todayLoad: 3 },
    { name: "Kiran", subjectQualified: true, courseFamiliar: false, todayLoad: 1 },
  ]);
  assert.deepEqual(candidates.map(candidate => candidate.name), ["Ravi", "Ajay", "Kiran", "Neha"]);
});
