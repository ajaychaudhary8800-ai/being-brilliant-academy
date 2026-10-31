import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { allocationWhere, effectiveDateForSession } from "../lib/subject-resolution.js";

const scope = { organizationId: "org-schoolos-classday-test", groupLabelType: "SECTION" };
const input = {
  branchId: "ndg-branch", courseId: "grade-6-course", batchId: "class-6A",
  teacherId: "school-teacher", subjectId: "physics-subject",
  academicSessionId: "session-2026", effectiveAt: new Date("2026-11-01T00:00:00.000Z"),
};

test("school class-day allocation query rejects expired/future assignments and inactive teachers", () => {
  const query = allocationWhere(input, scope);
  assert.equal(query.organizationId, scope.organizationId);
  assert.equal(query.branchId, input.branchId);
  assert.equal(query.batchId, input.batchId);
  assert.equal(query.courseId, input.courseId);
  assert.equal(query.teacherId, input.teacherId);
  assert.equal(query.subjectId, input.subjectId);
  assert.equal(query.academicSessionId, input.academicSessionId);
  assert.equal(query.status, "ACTIVE");
  assert.deepEqual(query.effectiveFrom, { lte: input.effectiveAt });
  assert.deepEqual(query.OR, [{ effectiveTo: null }, { effectiveTo: { gte: input.effectiveAt } }]);
  assert.deepEqual(query.teacher, {
    organizationId: scope.organizationId, branchId: input.branchId,
    user: { isActive: true },
  });
  assert.deepEqual(query.branch, { organizationId: scope.organizationId, isActive: true });
  assert.deepEqual(query.academicSession, { organizationId: scope.organizationId, isArchived: false });
  assert.deepEqual(query.batch, { organizationId: scope.organizationId, status: "ACTIVE" });
});

test("academic effective date clamps to session endpoints for future, current and past sessions", () => {
  const start = new Date("2026-04-01T00:00:00.000Z");
  const end = new Date("2027-03-31T00:00:00.000Z");
  assert.equal(effectiveDateForSession(start, end, new Date("2026-02-01Z")).getTime(), start.getTime());
  assert.equal(effectiveDateForSession(start, end, new Date("2027-05-01Z")).getTime(), end.getTime());
  assert.equal(effectiveDateForSession(start, end, new Date("2026-11-15Z")).getTime(), new Date("2026-11-15Z").getTime());
});

test("class-day preview, transactional save and Copy Entire Day all enforce effective teacher-subject eligibility", async () => {
  const source = await readFile(new URL("./admin-timetables.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function checkClassDay(");
  const end = source.indexOf("// Copy saved active teaching lessons", start);
  assert.ok(start >= 0 && end > start);
  const checked = source.slice(start, end);
  assert.match(checked, /effectiveDateForSession\(batch\.session\.startsAt, batch\.session\.endsAt\)/);
  assert.match(checked, /db\.teacherAllocation\.findFirst\(\{\s*where: allocationWhere\(/);
  assert.match(checked, /organizationId: req\.auth!\.organizationId, groupLabelType: organization\.groupLabelType/);
  assert.match(checked, /db\.teacherSubject\.findUnique\(/);
  assert.match(checked, /db\.courseSubject\.findUnique\(/);
  assert.match(checked, /db\.subject\.findFirst\(/);
  assert.match(checked, /status: "ACTIVE", legacyReviewStatus: "CONFIRMED"/);
  assert.match(checked, /if \(!assigned \|\| !courseLink\?\.isActive \|\| !teacherLink \|\| !activeSubject\)/);
  assert.match(source, /router\.post\("\/timetables\/class-day\/preview"[\s\S]*?checkClassDay\(req, entries\)/);
  assert.match(source, /router\.post\("\/timetables\/class-day",[^]*?checkClassDay\(req, ordered, tx\)/);
  assert.match(source, /router\.post\("\/timetables\/class-day\/copy",[^]*?planSchoolDayCopy\(req,inputCopy,tx\)/);
  assert.match(source, /const checked=await checkClassDay\(req,entries,db\)/);
});
