import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./admin-timetables.ts", import.meta.url), "utf8");
const single = source.slice(source.indexOf("async function validate("), source.indexOf('router.get("/timetables/options"'));
function region(start: string, end: string) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, "Expected timetable route region");
  return source.slice(a, b);
}

test("single-period validator rejects non-effective allocations for live timetable writes", () => {
  assert.match(single, /if\(d\.status!==TimetableStatus\.ARCHIVED\)/);
  assert.match(single, /effectiveDateForSession\(batch\.session\.startsAt,batch\.session\.endsAt\)/);
  assert.match(single, /db\.teacherAllocation\.findFirst\(\{where:allocationWhere\(/);
  assert.match(single, /organizationId:batch\.organizationId,groupLabelType:org\?\.groupLabelType/);
  assert.match(single, /db\.teacherSubject\.findUnique\(/);
  assert.match(single, /db\.subject\.findFirst\(/);
  assert.match(single, /status:"ACTIVE",legacyReviewStatus:"CONFIRMED"/);
  assert.match(single, /if\(!allocation\|\|!teacherSubject\|\|!activeSubject\)/);
  assert.match(single, /TEACHER_SUBJECT_NOT_ALLOCATED/);
  assert.match(single, /teacher:\s*true/); // teacher profile continues to be read for base eligibility
});

test("all individual timetable entry creation, edit and archive reactivation reuse guarded validator", () => {
  const post = region('router.post("/timetables",', 'router.patch("/timetables/:id",');
  const edit = region('router.patch("/timetables/:id",', 'router.patch("/timetables/:id/status",');
  const status = region('router.patch("/timetables/:id/status",', 'router.delete("/timetables/:id",');
  assert.match(post, /await validate\(d,undefined,tx\)/);
  assert.match(edit, /await validate\(d,old\.id,tx\)/);
  assert.match(status, /old\.status===TimetableStatus\.ARCHIVED && status!==TimetableStatus\.ARCHIVED/);
  assert.match(status, /await validate\(\{[\s\S]*?\},old\.id,tx\)/);
  for (const section of [post, edit, status]) {
    assert.match(section, /TransactionIsolationLevel\.Serializable/);
    assert.match(section, /lockTimetableBranch\(tx/);
  }
});
