import assert from "node:assert/strict";
import test from "node:test";
import { expandAllocationSelections } from "./allocation-expansion.js";
import { allocationPeriodKey, applyAllocationPeriods } from "./allocation-periods.js";

const selections = expandAllocationSelections([
  { courseId: "class1", batchIds: ["sectionA"], subjectIds: ["maths", "gk"] },
  { courseId: "class2", batchIds: ["sectionA", "sectionB"], subjectIds: ["maths"] },
]);

test("weekly periods may differ by subject and section in one teacher allocation", () => {
  const rows = applyAllocationPeriods(selections, 6, [
    { courseId: "class1", batchId: "sectionA", subjectId: "gk", weeklyPeriods: 2 },
    { courseId: "class2", batchId: "sectionB", subjectId: "maths", weeklyPeriods: 4 },
  ]);
  assert.deepEqual(rows.map(row => row.weeklyPeriods), [6, 2, 6, 4]);
  assert.equal(rows.reduce((sum, row) => sum + row.weeklyPeriods, 0), 18);
  assert.equal(allocationPeriodKey(rows[0]), "class1:sectionA:maths");
});

test("legacy bulk clients still receive the common weekly periods value", () => {
  assert.deepEqual(applyAllocationPeriods(selections, 5).map(row => row.weeklyPeriods), [5, 5, 5, 5]);
});

test("unselected subjects and unrelated sections cannot receive overrides", () => {
  assert.throws(() => applyAllocationPeriods(selections, 6, [
    { courseId: "class1", batchId: "sectionC", subjectId: "maths", weeklyPeriods: 2 },
  ]), /Weekly periods can only be specified for selected/);
  assert.throws(() => applyAllocationPeriods(selections, 6, [
    { courseId: "class1", batchId: "sectionA", subjectId: "science", weeklyPeriods: 2 },
  ]), /Weekly periods can only be specified for selected/);
});

test("duplicate overrides and invalid period counts are rejected", () => {
  const item = { courseId: "class1", batchId: "sectionA", subjectId: "gk", weeklyPeriods: 2 };
  assert.throws(() => applyAllocationPeriods(selections, 6, [item, item]), /only one weekly-period value/);
  for (const invalid of [0, 101, 1.5, -1, Number.NaN]) {
    assert.throws(() => applyAllocationPeriods(selections, 6, [{ ...item, weeklyPeriods: invalid }]), /whole number between 1 and 100/);
  }
});

test("empty selections cannot be populated through overrides", () => {
  assert.deepEqual(applyAllocationPeriods([], 6), []);
  assert.throws(() => applyAllocationPeriods([], 6, [
    { courseId: "class1", batchId: "sectionA", subjectId: "gk", weeklyPeriods: 2 },
  ]), /only be specified for selected/);
});
