import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const meetingUi = await readFile(new URL("../../../web/app/admin/meetings/page.tsx", import.meta.url), "utf8");
const subjectUi = await readFile(new URL("../../../web/components/bulk-allocation-dialog.tsx", import.meta.url), "utf8");
const subjectsRoute = await readFile(new URL("./admin-subjects.ts", import.meta.url), "utf8");

test("staff meeting scheduling keeps current tenant super admins eligible when a branch is chosen", () => {
  assert.match(meetingUi, /user\?\.role==="SUPER_ADMIN" && x\.role==="SUPER_ADMIN"/);
  assert.match(meetingUi, /f\.hostUserId=staff\.find\(x=>x\.id===user\?\.id\)\?\.id\?\?""/);
  assert.match(meetingUi, /Host"><select required/);
});

test("staff meeting scope remains enforced by API before assigning a host", async () => {
  const route = await readFile(new URL("./meetings.ts", import.meta.url), "utf8");
  assert.match(route, /await validateScope\(req, data\.branchId, data\.departmentId\)/);
  assert.match(route, /await resolvedParticipants\(req, data\)/);
});

test("allocation subject choices report missing teacher mappings without enabling invalid allocations", () => {
  assert.match(subjectsRoute, /const assignedIds = new Set/);
  assert.match(subjectsRoute, /const available = confirmed\.filter\(row => assignedIds\.has\(row\.subject\.id\)\)/);
  assert.match(subjectsRoute, /missingTeacherSubjects/);
  assert.match(subjectsRoute, /unavailableCourseSubjects/);
  assert.match(subjectUi, /selection\.missingTeacherSubjects\.join\(", "\)/);
  assert.match(subjectUi, /selection\.unavailableCourseSubjects\.join\(", "\)/);
  assert.match(subjectUi, /Assign them under Teachers/);
});
