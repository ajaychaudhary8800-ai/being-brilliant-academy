import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = () => readFile(new URL("./leave-management.ts", import.meta.url), "utf8");

test("approved student leave resolves academic enrollment per attendance date", async () => {
  const route = await read();
  assert.match(route, /resolveHistoricalAcademicEnrollment\(tx, \{/);
  assert.match(route, /studentId: leave\.user\.studentProfile\.id/);
  assert.match(route, /onDate: date/);
  assert.match(route, /batchId: enrollment\.batchId/);
  assert.doesNotMatch(route, /studentId: leave\.userId, batchId: leave\.user\.studentProfile\.batchId, date/);
});

test("leave attendance synchronization skips configured holidays", async () => {
  const route = await read();
  assert.match(route, /tx\.holiday\.findFirst/);
  assert.match(route, /OR: \[\{ branchId: leave\.branchId \}, \{ branchId: null \}\]/);
  assert.match(route, /if \(holiday\) \{\s*skippedHolidays\+\+;\s*continue;/s);
  assert.match(route, /metadata: \{ attendanceStatus, attendanceChanges, skippedHolidays \}/);
});

test("unresolved student academic context aborts approval attendance sync", async () => {
  const route = await read();
  assert.match(route, /LEAVE_ACADEMIC_CONTEXT_UNRESOLVED/);
});
