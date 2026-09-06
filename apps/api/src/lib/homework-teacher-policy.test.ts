import assert from "node:assert/strict";
import test from "node:test";
import { HomeworkStatus, HomeworkSubmissionStatus, Role, TeacherAllocationStatus } from "@prisma/client";
import {
  assertActiveTeacherHomeworkUser,
  assertHomeworkManagerAccess,
  assertHomeworkSubmissionEvaluable,
  assertHomeworkSubmissionEvaluated,
  assertTeacherHomeworkEditable,
  assertTeacherHomeworkEvaluationOpen,
  assertTeacherHomeworkTransition,
  authenticatedTeacherHomeworkId,
  currentTeacherHomeworkAllocationContext,
  teacherHomeworkCreateStatus,
} from "./homework-policy.js";
import { allocationWhere } from "./subject-resolution.js";

const ownHomework = {
  requestOrganizationId: "org-a",
  homeworkOrganizationId: "org-a",
  homeworkTeacherId: "teacher-a",
  branchAllowed: true,
};

test("active Teacher owns historical reads while identity, tenant and branch IDOR remain blocked", () => {
  assert.doesNotThrow(() => assertHomeworkManagerAccess({ ...ownHomework, role: Role.TEACHER, authenticatedTeacherId: "teacher-a" }));
  assert.throws(() => assertHomeworkManagerAccess({ ...ownHomework, role: Role.TEACHER, authenticatedTeacherId: "teacher-b" }), /Homework access denied/);
  assert.throws(() => assertHomeworkManagerAccess({ ...ownHomework, requestOrganizationId: "org-b", role: Role.TEACHER, authenticatedTeacherId: "teacher-a" }), /Homework access denied/);
  assert.throws(() => assertHomeworkManagerAccess({ ...ownHomework, branchAllowed: false, role: Role.TEACHER, authenticatedTeacherId: "teacher-a" }), /Homework access denied/);
  assert.equal(authenticatedTeacherHomeworkId("teacher-a"), "teacher-a");
  assert.throws(() => authenticatedTeacherHomeworkId("teacher-a", "teacher-b"), /only manage their own homework/);
});

test("deactivated Teacher accounts cannot manage Homework with an existing token", () => {
  assert.doesNotThrow(() => assertActiveTeacherHomeworkUser(true));
  assert.throws(() => assertActiveTeacherHomeworkUser(false), /active Teacher account is required/);
});

test("current server time, never a backdated assigned date, defines Teacher allocation authority", () => {
  const serverNow = new Date("2026-09-06T10:00:00.000Z");
  const backdatedAssignedDate = new Date("2025-04-01T00:00:00.000Z");
  const context = currentTeacherHomeworkAllocationContext({
    branchId: "branch-a",
    courseId: "course-a",
    batchId: "batch-a",
    teacherId: "teacher-a",
    academicSessionId: "session-a",
    subjectId: "subject-a",
  }, serverNow);
  const where = allocationWhere(context);
  assert.equal(context.effectiveAt, serverNow);
  assert.notEqual(context.effectiveAt, backdatedAssignedDate);
  assert.deepEqual(where, {
    branchId: "branch-a",
    courseId: "course-a",
    batchId: "batch-a",
    teacherId: "teacher-a",
    academicSessionId: "session-a",
    subjectId: "subject-a",
    status: TeacherAllocationStatus.ACTIVE,
    effectiveFrom: { lte: serverNow },
    OR: [{ effectiveTo: null }, { effectiveTo: { gte: serverNow } }],
  });
  assert.ok(new Date("2026-09-05T23:59:59.000Z") < serverNow, "an allocation expired before request time cannot match this query");
});

test("complete allocation context rejects unauthorized batch and Subject substitutions", () => {
  const now = new Date("2026-09-06T10:00:00.000Z");
  const allowed = allocationWhere(currentTeacherHomeworkAllocationContext({ branchId: "branch-a", courseId: "course-a", batchId: "batch-a", teacherId: "teacher-a", academicSessionId: "session-a", subjectId: "subject-a" }, now));
  const wrongBatch = allocationWhere(currentTeacherHomeworkAllocationContext({ branchId: "branch-a", courseId: "course-a", batchId: "batch-b", teacherId: "teacher-a", academicSessionId: "session-a", subjectId: "subject-a" }, now));
  const wrongSubject = allocationWhere(currentTeacherHomeworkAllocationContext({ branchId: "branch-a", courseId: "course-a", batchId: "batch-a", teacherId: "teacher-a", academicSessionId: "session-a", subjectId: "subject-b" }, now));
  assert.notDeepEqual(wrongBatch, allowed);
  assert.notDeepEqual(wrongSubject, allowed);
});

test("Teacher-created Homework is draft-only", () => {
  assert.equal(teacherHomeworkCreateStatus(), HomeworkStatus.DRAFT);
  assert.equal(teacherHomeworkCreateStatus(HomeworkStatus.DRAFT), HomeworkStatus.DRAFT);
  for (const status of [HomeworkStatus.PUBLISHED, HomeworkStatus.CLOSED, HomeworkStatus.ARCHIVED]) {
    assert.throws(() => teacherHomeworkCreateStatus(status), /created as draft/);
  }
});

test("Teacher Homework lifecycle permits only DRAFT to PUBLISHED to CLOSED", () => {
  assert.doesNotThrow(() => assertTeacherHomeworkTransition(HomeworkStatus.DRAFT, HomeworkStatus.PUBLISHED));
  assert.doesNotThrow(() => assertTeacherHomeworkTransition(HomeworkStatus.PUBLISHED, HomeworkStatus.CLOSED));
  for (const [from, to] of [
    [HomeworkStatus.DRAFT, HomeworkStatus.CLOSED],
    [HomeworkStatus.DRAFT, HomeworkStatus.ARCHIVED],
    [HomeworkStatus.PUBLISHED, HomeworkStatus.DRAFT],
    [HomeworkStatus.CLOSED, HomeworkStatus.PUBLISHED],
    [HomeworkStatus.CLOSED, HomeworkStatus.DRAFT],
    [HomeworkStatus.ARCHIVED, HomeworkStatus.PUBLISHED],
    [HomeworkStatus.ARCHIVED, HomeworkStatus.DRAFT],
    [HomeworkStatus.ARCHIVED, HomeworkStatus.CLOSED],
  ] as const) assert.throws(() => assertTeacherHomeworkTransition(from, to), /transition is not allowed/);
  assert.doesNotThrow(() => assertTeacherHomeworkEditable(HomeworkStatus.DRAFT));
  assert.doesNotThrow(() => assertTeacherHomeworkEditable(HomeworkStatus.PUBLISHED));
  assert.throws(() => assertTeacherHomeworkEditable(HomeworkStatus.CLOSED), /cannot be edited/);
  assert.throws(() => assertTeacherHomeworkEditable(HomeworkStatus.ARCHIVED), /cannot be edited/);
});

test("submission evaluation is limited to open Homework and unreviewed submissions", () => {
  assert.doesNotThrow(() => assertTeacherHomeworkEvaluationOpen(HomeworkStatus.PUBLISHED));
  assert.doesNotThrow(() => assertTeacherHomeworkEvaluationOpen(HomeworkStatus.CLOSED));
  assert.throws(() => assertTeacherHomeworkEvaluationOpen(HomeworkStatus.DRAFT), /cannot be evaluated/);
  assert.throws(() => assertTeacherHomeworkEvaluationOpen(HomeworkStatus.ARCHIVED), /cannot be evaluated/);
  assert.doesNotThrow(() => assertHomeworkSubmissionEvaluable(HomeworkSubmissionStatus.SUBMITTED));
  assert.doesNotThrow(() => assertHomeworkSubmissionEvaluable(HomeworkSubmissionStatus.LATE));
  assert.throws(() => assertHomeworkSubmissionEvaluable(HomeworkSubmissionStatus.EVALUATED), /cannot be evaluated again/);
  assert.throws(() => assertHomeworkSubmissionEvaluable(HomeworkSubmissionStatus.RETURNED), /cannot be evaluated again/);
  assert.doesNotThrow(() => assertHomeworkSubmissionEvaluated(1));
  assert.throws(() => assertHomeworkSubmissionEvaluated(0), /cannot be evaluated again/);
});

test("Super Admin and Branch Admin Homework authority remains unchanged and scoped", () => {
  assert.doesNotThrow(() => assertHomeworkManagerAccess({ ...ownHomework, role: Role.SUPER_ADMIN }));
  assert.doesNotThrow(() => assertHomeworkManagerAccess({ ...ownHomework, role: Role.BRANCH_ADMIN }));
  assert.throws(() => assertHomeworkManagerAccess({ ...ownHomework, role: Role.BRANCH_ADMIN, branchAllowed: false }), /Homework access denied/);
  assert.throws(() => assertHomeworkManagerAccess({ ...ownHomework, requestOrganizationId: "org-b", role: Role.BRANCH_ADMIN }), /Homework access denied/);
});
