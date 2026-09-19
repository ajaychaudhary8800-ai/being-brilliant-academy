import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { AppError } from "./http.js";
import { processBulkAcademicTransitions } from "./bulk-academic-transitions.js";

const student = (suffix: string) => `c${suffix.padEnd(24, "0").slice(0, 24)}`;
const item = (id: string, overrides: Record<string, unknown> = {}) => ({ studentId: id, type: "PROMOTED", effectiveDate: "2027-04-01", targetBatchId: student("batch"), rollNo: "R-1", ...overrides });
const transition = (id: string, type = "PROMOTED") => ({ id: `transition-${id}`, type, effectiveDate: new Date("2027-04-01"), fromEnrollmentId: `from-${id}`, toEnrollmentId: type === "LEFT" || type === "GRADUATED" ? null : `to-${id}` });

test("one-item bulk request succeeds with a projected transition", async () => {
  const result = await processBulkAcademicTransitions({ items: [item(student("single"))] }, async value => transition(value.studentId, value.type));
  assert.equal(result.status, 200);
  assert.equal(result.data.total, 1);
  assert.equal(result.data.succeeded, 1);
  assert.equal(result.data.results[0]!.ok, true);
});

test("bulk processor returns ordered successful independent outcomes", async () => {
  const calls: string[] = [];
  const result = await processBulkAcademicTransitions({ items: [item(student("one")), item(student("two"))] }, async value => { calls.push(value.studentId); return transition(value.studentId); });
  assert.equal(result.status, 200);
  assert.deepEqual(calls, [student("one"), student("two")]);
  assert.deepEqual(result.data.results.map(row => row.studentId), [student("one"), student("two")]);
  assert.equal(result.data.succeeded, 2);
});

test("one-item destination transition preserves target validation errors", async () => {
  const result = await processBulkAcademicTransitions({ items: [item(student("target"), { targetBatchId: undefined, rollNo: undefined })] }, async () => {
    throw new AppError(422, "INVALID_TRANSITION_TARGET", "A destination Batch is required for this transition");
  });
  assert.equal(result.status, 207);
  assert.equal(result.data.total, 1);
  assert.equal(result.data.results[0]!.error?.code, "INVALID_TRANSITION_TARGET");
  assert.equal(result.data.results[0]!.error?.message, "A destination Batch is required for this transition");
});

test("one failure does not roll back or stop later items", async () => {
  const calls: string[] = [];
  const result = await processBulkAcademicTransitions({ items: [item(student("one")), { bad: true }, item(student("three"), { type: "LEFT", targetBatchId: undefined, rollNo: undefined }), item(student("four"), { type: "GRADUATED", targetBatchId: undefined, rollNo: undefined })] }, async value => {
    calls.push(value.studentId);
    if (value.studentId === student("one")) throw new AppError(409, "BATCH_CAPACITY_REACHED", "Destination is full");
    return transition(value.studentId, value.type);
  });
  assert.equal(result.status, 207);
  assert.deepEqual(calls, [student("one"), student("three"), student("four")]);
  assert.equal(result.data.results[0]!.error?.code, "BATCH_CAPACITY_REACHED");
  assert.equal(result.data.results[1]!.error?.code, "VALIDATION_ERROR");
  assert.equal(result.data.results[2]!.ok, true);
  assert.equal(result.data.results[3]!.ok, true);
});

test("outer limits and duplicate IDs reject before any mutation", async () => {
  let calls = 0;
  await assert.rejects(processBulkAcademicTransitions({ items: [] }, async () => { calls += 1; return transition("x"); }), (error: AppError) => error.status === 422);
  await assert.rejects(processBulkAcademicTransitions({ items: Array.from({ length: 101 }, (_, index) => item(student(String(index)))) }, async () => { calls += 1; return transition("x"); }), (error: AppError) => error.code === "BULK_LIMIT_EXCEEDED");
  await assert.rejects(processBulkAcademicTransitions({ items: [item(student("same")), item(student("same"))] }, async () => { calls += 1; return transition("x"); }), (error: AppError) => error.code === "DUPLICATE_BULK_STUDENT");
  assert.equal(calls, 0);
});

test("unexpected failures are sanitized and later items continue", async () => {
  const logged: string[] = [];
  const result = await processBulkAcademicTransitions({ items: [item(student("one")), item(student("two"))] }, async value => { if (value.studentId === student("one")) throw new Error("database secret"); return transition(value.studentId); }, context => logged.push(context.studentId));
  assert.equal(result.status, 207);
  assert.equal(result.data.results[0]!.error?.code, "INTERNAL_ERROR");
  assert.equal(result.data.results[0]!.error?.message, "An unexpected error occurred");
  assert.equal(result.data.results[1]!.ok, true);
  assert.deepEqual(logged, [student("one")]);
});

test("terminal transitions do not require a destination and route reuses the guarded engine sequentially", () => {
  const source = readFileSync(fileURLToPath(new URL("../routes/admin-students.ts", import.meta.url)), "utf8");
  assert.match(source, /students\/academic-transitions\/bulk/);
  assert.match(source, /authorizeBranchIds: tx => assignedBranches\(req, tx\)/);
  assert.match(source, /processBulkAcademicTransitions\(req\.body/);
  assert.doesNotMatch(source, /Promise\.all\(.*transitionStudentAcademicPlacement/s);
  assert.match(source, /transitionStudentAcademicPlacement\(prisma/);
});
