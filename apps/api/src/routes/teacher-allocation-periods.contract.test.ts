import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("./admin-teacher-allocations.ts", import.meta.url), "utf8");
const form = await readFile(new URL("../../../web/components/bulk-allocation-dialog.tsx", import.meta.url), "utf8");
const matrix = await readFile(new URL("../../../web/components/allocation-period-matrix.tsx", import.meta.url), "utf8");

test("bulk teacher allocations support per-row weekly periods with backward compatibility", () => {
  assert.match(route, /periodOverrides: z\.array/);
  assert.match(route, /applyAllocationPeriods\(selectedRows, data\.weeklyPeriods, data\.periodOverrides\)/);
  assert.match(route, /weeklyPeriods: selection\.weeklyPeriods/);
  assert.match(route, /weeklyPeriods \}\) => \(\{ courseId, courseTitle, batchId, batchName, subjectId, subjectName, weeklyPeriods \}\)/);
  assert.match(route, /if \(selectedRows\.length > 500\)/);
});

test("the class-section-subject matrix submits exact periods per unique allocation", () => {
  assert.match(form, /<AllocationPeriodMatrix rows=\{allocationRows\}/);
  assert.match(form, /periodOverrides: allocationRows\.map\(row => \(\{ courseId: row\.courseId, batchId: row\.batchId, subjectId: row\.subjectId/);
  assert.match(form, /disabled=\{loading \|\| conflicts > 0 \|\| !ready\}/);
  assert.match(form, /row\.weeklyPeriods\}<\/b> periods\/week/);
  assert.match(matrix, /Exact weekdays and timings are configured in Timetable Management/);
  assert.match(matrix, /type="number"/);
  assert.match(matrix, /aria-label=\{`Weekly periods for/);
});
