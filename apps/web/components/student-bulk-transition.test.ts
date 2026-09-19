import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildBulkResultsCsv, buildBulkTransitionPayload, duplicateBulkRollNumbers, initialBulkRollNumbers, localResultsFilename, selectionWithStudent, BULK_TRANSITION_LIMIT } from "./student-bulk-transition";

const student = (id: string, rollNo: string | null = "r-1") => ({ id, user: { name: `Student ${id}` }, rollNo, branch: { id: "branch-1", name: "Main" }, course: { id: "course-1", title: "Class 10" }, batch: { id: "batch-1", name: "Section A" }, academicSession: "2026-27" });

test("bulk payload preserves selected order and omits destination fields for terminal transitions", () => {
  const students = [student("one"), student("two", null)];
  assert.deepEqual(buildBulkTransitionPayload(students, { type: "PROMOTED", effectiveDate: "2026-09-19", targetBatchId: "batch-2", reason: " year end " }, { one: " r-9 ", two: "r-10" }), {
    items: [
      { studentId: "one", type: "PROMOTED", effectiveDate: "2026-09-19", targetBatchId: "batch-2", rollNo: "R-9", reason: "year end" },
      { studentId: "two", type: "PROMOTED", effectiveDate: "2026-09-19", targetBatchId: "batch-2", rollNo: "R-10", reason: "year end" },
    ],
  });
  assert.deepEqual(buildBulkTransitionPayload(students, { type: "LEFT", effectiveDate: "2026-09-19", targetBatchId: "must-not-send", reason: " left " }, { one: "must-not-send", two: "must-not-send" }), {
    items: [{ studentId: "one", type: "LEFT", effectiveDate: "2026-09-19", reason: "left" }, { studentId: "two", type: "LEFT", effectiveDate: "2026-09-19", reason: "left" }],
  });
});

test("selection is capped at 100 and retains student data", () => {
  let selection = new Map<string, ReturnType<typeof student>>();
  for (let index = 0; index < BULK_TRANSITION_LIMIT + 1; index += 1) selection = selectionWithStudent(selection, student(String(index)));
  assert.equal(selection.size, BULK_TRANSITION_LIMIT);
  assert.equal(selection.get("0")?.user.name, "Student 0");
  assert.equal(selection.has(String(BULK_TRANSITION_LIMIT)), false);
});

test("destination roll numbers normalize and duplicate values are detected", () => {
  const students = [{ ...student("one", "A"), currentEnrollment: { rollNo: "CURRENT-1" } }, student("two", "B"), student("three", "C")];
  assert.deepEqual(initialBulkRollNumbers(students), { one: "CURRENT-1", two: "B", three: "C" });
  assert.deepEqual(duplicateBulkRollNumbers(students, { one: " r-7 ", two: "R-7", three: "r-8" }, "TRANSFERRED"), ["R-7"]);
  assert.deepEqual(duplicateBulkRollNumbers(students, { one: " r-7 ", two: "R-7", three: "r-8" }, "GRADUATED"), []);
});

test("CSV output has deterministic quoted headers and safe result rows", () => {
  const csv = buildBulkResultsCsv({ httpStatus: 207, data: { total: 2, succeeded: 1, failed: 1, results: [
    { index: 0, studentId: "one", ok: true, transition: { id: "tr-1", type: "PROMOTED", effectiveDate: "2026-09-19", fromEnrollmentId: "from-1", toEnrollmentId: "to-1" } },
    { index: 1, studentId: "two", ok: false, status: 409, error: { code: "BATCH_CAPACITY_REACHED", message: "Capacity, \"full\"\nretry later" } },
  ] } }, [student("one"), student("two")], { type: "PROMOTED", effectiveDate: "2026-09-19", destinationName: "Section, B", rolls: { one: " r-1 ", two: " r,2 " } });
  assert.match(csv, /^\uFEFFResult Index,Student Name,Student ID,Transition Type/);
  assert.match(csv, /"Section, B"/);
  assert.match(csv, /"Capacity, ""full""\nretry later"/);
  assert.equal(localResultsFilename("2026-09-19"), "academic-transition-results-2026-09-19.csv");
});

test("partial CSV preserves submitted context and per-row HTTP statuses", () => {
  const csv = buildBulkResultsCsv({ httpStatus: 207, data: { total: 2, succeeded: 1, failed: 1, results: [
    { index: 0, studentId: "one", ok: true, transition: { id: "tr-1", type: "PROMOTED", effectiveDate: "server-date", fromEnrollmentId: "from-1", toEnrollmentId: "to-1" } },
    { index: 1, studentId: "two", ok: false, status: 409, error: { code: "BATCH_CAPACITY_REACHED", message: "Capacity, \"full\"\nretry later" } },
  ] } }, [student("one"), student("two")], { type: "TRANSFERRED", effectiveDate: "2026-09-19", destinationName: "Section B", rolls: { one: " r-1 ", two: " r-2 " } });
  const rows = csv.split("\r\n");
  assert.match(rows[1]!, /TRANSFERRED/);
  assert.match(rows[1]!, /2026-09-19/);
  assert.match(rows[1]!, /R-1/);
  assert.match(rows[1]!, /,200,/);
  assert.match(rows[2]!, /TRANSFERRED/);
  assert.match(rows[2]!, /2026-09-19/);
  assert.match(rows[2]!, /R-2/);
  assert.match(rows[2]!, /,409,/);
});

test("terminal CSV leaves destination context blank", () => {
  const csv = buildBulkResultsCsv({ httpStatus: 200, data: { total: 1, succeeded: 1, failed: 0, results: [{ index: 0, studentId: "one", ok: true, transition: { id: "tr-1", type: "LEFT", effectiveDate: "server-date", fromEnrollmentId: "from-1", toEnrollmentId: null } }] } }, [student("one")], { type: "LEFT", effectiveDate: "2026-09-19", destinationName: "Should be blank", rolls: { one: "R-1" } });
  assert.match(csv, /LEFT,2026-09-19,,,Success/);
});

test("bulk dialog uses one bulk request, accepts 207, and does not replay successes", () => {
  const source = readFileSync(fileURLToPath(new URL("./student-bulk-transition-dialog.tsx", import.meta.url)), "utf8");
  assert.match(source, /academic-transitions\/bulk/);
  assert.doesNotMatch(source, /students\/\$\{student\.id\}\/academic-transitions/);
  assert.match(source, /http\.status !== 200 && http\.status !== 207/);
  assert.match(source, /successful rows are not automatically retried/);
  assert.match(source, /onCancel/);
  assert.match(source, /onCompletedClose/);
});
