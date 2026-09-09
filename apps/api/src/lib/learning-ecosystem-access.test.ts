import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Role } from "@prisma/client";
import {
  assertLearnerContentAccess,
  assertManagerQuestionAccess,
  assertManagerResourceAccess,
  learningDoubtWhere,
  learningQuestionWhere,
  learningResourceWhere,
  type LearningActor,
} from "./learning-ecosystem-access.js";

const routeSource = readFileSync(new URL("../routes/learning-ecosystem.ts", import.meta.url), "utf8");

const base = (role: Role, overrides: Partial<LearningActor> = {}): LearningActor => ({ role, userId: "user-a", branchIds: [], courseIds: [], allocations: [], learners: [], ...overrides });
const allocation = { branchId: "branch-a", courseId: "course-a", batchId: "batch-a", subjectId: "subject-a" };
const learner = { ...allocation, profileId: "profile-a", userId: "student-a" };

test("non-academic roles have no Learning Ecosystem scope", () => {
  for (const role of [Role.ACCOUNTANT, Role.EMPLOYEE]) assert.throws(() => learningResourceWhere(base(role)));
});

test("Branch Admin scope is assigned-branch-only and zero assignments remain empty", () => {
  assert.deepEqual(learningResourceWhere(base(Role.BRANCH_ADMIN)), { branchId: { in: [] } });
  assert.deepEqual(learningResourceWhere(base(Role.BRANCH_ADMIN, { branchIds: ["branch-a"] })), { branchId: { in: ["branch-a"] } });
  assert.throws(() => assertManagerResourceAccess(base(Role.BRANCH_ADMIN, { branchIds: ["branch-a"] }), { ...allocation, branchId: "branch-b" }));
  assert.doesNotThrow(() => assertManagerResourceAccess(base(Role.BRANCH_ADMIN, { branchIds: ["branch-a"] }), allocation));
});

test("Teacher scope is the active exact allocation tuple", () => {
  const teacher = base(Role.TEACHER, { teacherProfileId: "teacher-profile-a", allocations: [allocation] });
  assert.deepEqual(learningResourceWhere(teacher), { OR: [{ branchId: "branch-a", courseId: "course-a", AND: [{ OR: [{ batchId: null }, { batchId: "batch-a" }] }, { OR: [{ subjectId: null }, { subjectId: "subject-a" }] }] }] });
  assert.throws(() => assertManagerResourceAccess(teacher, { ...allocation, teacherId: "teacher-profile-b" }, { teacherOwned: true }));
  assert.doesNotThrow(() => assertManagerResourceAccess(teacher, { ...allocation, teacherId: "teacher-profile-a" }, { teacherOwned: true }));
  assert.throws(() => assertManagerQuestionAccess(teacher, { courseId: "course-b", subjectId: "subject-a" }));
  assert.doesNotThrow(() => assertManagerQuestionAccess(teacher, { courseId: "course-a", subjectId: "subject-a" }));
});

test("Student and Parent scopes are learner-context-only and content remains published", () => {
  const student = base(Role.STUDENT, { learners: [learner] });
  const parent = base(Role.PARENT, { learners: [learner] });
  assert.deepEqual(learningResourceWhere(student), { OR: [{ status: "PUBLISHED", courseId: "course-a", AND: [{ OR: [{ branchId: null }, { branchId: "branch-a" }] }, { OR: [{ batchId: null }, { batchId: "batch-a" }] }] }] });
  assert.doesNotThrow(() => assertLearnerContentAccess(student, { ...allocation, status: "PUBLISHED" }));
  assert.doesNotThrow(() => assertLearnerContentAccess(parent, { ...allocation, status: "PUBLISHED" }));
  assert.throws(() => assertLearnerContentAccess(student, { ...allocation, courseId: "course-b", status: "PUBLISHED" }));
  assert.throws(() => assertLearnerContentAccess(parent, { ...allocation, status: "DRAFT" }));
});

test("Question and doubt scopes never grant students answer-bank or organization-wide access", () => {
  assert.throws(() => learningQuestionWhere(base(Role.STUDENT, { learners: [learner] })));
  assert.deepEqual(learningDoubtWhere(base(Role.STUDENT, { userId: "student-a" })), { studentId: "student-a" });
  assert.deepEqual(learningDoubtWhere(base(Role.BRANCH_ADMIN, { branchIds: ["branch-a"] }),), { student: { studentProfile: { is: { branchId: { in: ["branch-a"] }, status: "ACTIVE" } } } });
});

test("Question answer keys and direct-ID learning operations use protected paths", () => {
  assert.match(routeSource, /router\.get\("\/learning\/questions", managers/);
  assert.match(routeSource, /question: \{ select: \{ id: true, code: true, type: true, body: true, options: true, marks: true \} \}/);
  assert.match(routeSource, /learningTestQuestion\.findFirst\(\{ where: \{ testId: attempt\.testId, questionId \}/);
  assert.match(routeSource, /learningQuestionWhere\(actor\)/);
  assert.match(routeSource, /learningResourceWhere\(actor\)/);
  assert.match(routeSource, /learningAttemptStudentWhere\(actor\)/);
  assert.doesNotMatch(routeSource, /router\.get\("\/learning\/questions", async/);
});
