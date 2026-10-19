import assert from "node:assert/strict";
import test from "node:test";
import { assertBatchCoachingGrades, assertStudentCoachingGrade, teacherAssignable } from "./coaching-academic-policy.js";

test("one same-tenant teacher can teach multiple coaching branches", () => {
  const teacher = { organizationId: "tenant-a", branchId: "branch-1" };
  assert.equal(teacherAssignable("BATCH", teacher, "branch-2", "tenant-a"), true);
  assert.equal(teacherAssignable("SECTION", teacher, "branch-2", "tenant-a"), false);
  assert.equal(teacherAssignable("GROUP", teacher, "branch-2", "tenant-a"), false);
  assert.equal(teacherAssignable("BATCH", teacher, "branch-2", "tenant-b"), false);
});
test("mixed-grade coaching batch accepts Classes 5, 6 and 7 only", () => {
  assertBatchCoachingGrades("BATCH", [5, 6, 7]);
  for (const grade of [5, 6, 7]) assert.equal(assertStudentCoachingGrade("BATCH", [5, 6, 7], grade), grade);
  assert.throws(() => assertStudentCoachingGrade("BATCH", [5, 6, 7], 8));
  assert.throws(() => assertStudentCoachingGrade("BATCH", [5, 6, 7], null));
  assert.throws(() => assertBatchCoachingGrades("BATCH", [5, 5]));
  assert.throws(() => assertBatchCoachingGrades("SECTION", [5, 6]));
  assert.throws(() => assertStudentCoachingGrade("SECTION", [], 5));
});
