import assert from "node:assert/strict";
import test from "node:test";
import { TeacherAllocationStatus } from "@prisma/client";
import { certificateTeacherAllocationWhere, selectEligibleParentHomeworkChild, teacherOwnsExamination } from "./portal-student-resource-policy.js";

test("report-card teacher access is limited to the examination owner", () => {
  assert.equal(teacherOwnsExamination("teacher-a", "teacher-a"), true);
  assert.equal(teacherOwnsExamination("teacher-a", "teacher-b"), false);
});

test("certificate teacher access requires exact branch, course and batch allocation context", () => {
  const effectiveAt = new Date("2026-09-20T00:00:00.000Z");
  assert.deepEqual(certificateTeacherAllocationWhere("teacher-a", {
    branchId: "branch-a",
    courseId: "course-a",
    batchId: "batch-a",
    effectiveAt,
  }), {
    teacherId: "teacher-a",
    branchId: "branch-a",
    courseId: "course-a",
    batchId: "batch-a",
    status: TeacherAllocationStatus.ACTIVE,
    effectiveFrom: { lte: effectiveAt },
    OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveAt } }],
  });
});

test("same branch is not sufficient when certificate course or batch is unrelated", () => {
  const effectiveAt = new Date("2026-09-20T00:00:00.000Z");
  const allowed = certificateTeacherAllocationWhere("teacher-a", {
    branchId: "branch-a",
    courseId: "course-a",
    batchId: "batch-a",
    effectiveAt,
  });
  const otherBatch = certificateTeacherAllocationWhere("teacher-a", {
    branchId: "branch-a",
    courseId: "course-a",
    batchId: "batch-b",
    effectiveAt,
  });
  const otherCourse = certificateTeacherAllocationWhere("teacher-a", {
    branchId: "branch-a",
    courseId: "course-b",
    batchId: "batch-a",
    effectiveAt,
  });
  assert.notDeepEqual(otherBatch, allowed);
  assert.notDeepEqual(otherCourse, allowed);
});

test("unscoped certificates do not become teacher-visible by branch alone", () => {
  const effectiveAt = new Date("2026-09-20T00:00:00.000Z");
  assert.equal(certificateTeacherAllocationWhere("teacher-a", {
    branchId: "branch-a",
    courseId: null,
    batchId: "batch-a",
    effectiveAt,
  }), null);
  assert.equal(certificateTeacherAllocationWhere("teacher-a", {
    branchId: "branch-a",
    courseId: "course-a",
    batchId: null,
    effectiveAt,
  }), null);
});


test("parent homework authorization accepts any eligible active linked child instead of the first link only", () => {
  const candidates = [
    { student: { batchId: "batch-unrelated" }, enrollment: null },
    { student: { batchId: "batch-target" }, enrollment: null },
  ];
  assert.equal(selectEligibleParentHomeworkChild(candidates, "batch-target"), candidates[1]);
});

test("parent homework authorization preserves historical eligibility after a child moves batches", () => {
  const historical = { id: "enrollment-history" };
  const candidates = [
    { student: { batchId: "batch-current" }, enrollment: historical },
  ];
  assert.equal(selectEligibleParentHomeworkChild(candidates, "batch-old"), candidates[0]);
  assert.equal(selectEligibleParentHomeworkChild([{ student: { batchId: "batch-other" }, enrollment: null }], "batch-old"), null);
});
