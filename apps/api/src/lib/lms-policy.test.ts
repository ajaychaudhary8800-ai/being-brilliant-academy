import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LmsContentStatus, Role } from "@prisma/client";
import { assertLmsContentAccess, assertLmsLessonEditable, assertLmsLessonStructuralEditAllowed, assertLmsLessonTransition, assertLmsManagementAccess, assertLmsModuleManagementAccess, lmsLessonBranchFilter, lmsLessonCreateStatus, lmsModuleCourseWhere, nextLmsProgress, type LmsActor } from "./lms-policy.js";

const target = { branchId: "branch-a", teacherId: "teacher-a", batchId: "batch-a", status: "PUBLISHED" };
const actor = (role: Role, overrides: Partial<LmsActor> = {}): LmsActor => ({ role, branchIds: [], ...overrides });

test("LMS management is limited to authorized administrators and the owning Teacher", () => {
  assert.doesNotThrow(() => assertLmsManagementAccess(actor(Role.SUPER_ADMIN), target));
  assert.doesNotThrow(() => assertLmsManagementAccess(actor(Role.BRANCH_ADMIN, { branchIds: ["branch-a"] }), target));
  assert.throws(() => assertLmsManagementAccess(actor(Role.BRANCH_ADMIN, { branchIds: ["branch-b"] }), target));
  assert.doesNotThrow(() => assertLmsManagementAccess(actor(Role.TEACHER, { branchIds: ["branch-a"], teacherProfileId: "teacher-a" }), target));
  assert.throws(() => assertLmsManagementAccess(actor(Role.TEACHER, { branchIds: ["branch-a"], teacherProfileId: "teacher-b" }), target));
  assert.throws(() => assertLmsManagementAccess(actor(Role.ACCOUNTANT), target));
  assert.throws(() => assertLmsManagementAccess(actor(Role.PARENT), target));
  assert.throws(() => assertLmsManagementAccess(actor(Role.STUDENT), target));
});

test("Students can read only published content assigned to their active Batch", () => {
  const student = actor(Role.STUDENT, { studentActive: true, studentBatchId: "batch-a" });
  assert.doesNotThrow(() => assertLmsContentAccess(student, target));
  assert.throws(() => assertLmsContentAccess(student, { ...target, status: "DRAFT" }));
  assert.throws(() => assertLmsContentAccess(student, { ...target, batchId: "batch-b" }));
  assert.throws(() => assertLmsContentAccess(actor(Role.STUDENT, { studentActive: false, studentBatchId: "batch-a" }), target));
});

test("Module management is Super Admin or assigned-branch Branch Admin only", () => {
  assert.doesNotThrow(() => assertLmsModuleManagementAccess(actor(Role.SUPER_ADMIN), { branchId: "branch-b" }));
  assert.doesNotThrow(() => assertLmsModuleManagementAccess(actor(Role.BRANCH_ADMIN, { branchIds: ["branch-a"] }), { branchId: "branch-a" }));
  assert.doesNotThrow(() => assertLmsModuleManagementAccess(actor(Role.BRANCH_ADMIN, { branchIds: ["branch-a"] }), { branchId: null }));
  assert.throws(() => assertLmsModuleManagementAccess(actor(Role.BRANCH_ADMIN, { branchIds: ["branch-a"] }), { branchId: "branch-b" }));
  assert.throws(() => assertLmsModuleManagementAccess(actor(Role.BRANCH_ADMIN), { branchId: null }));
  for (const role of [Role.TEACHER, Role.ACCOUNTANT, Role.STUDENT, Role.PARENT]) {
    assert.throws(() => assertLmsModuleManagementAccess(actor(role, { branchIds: ["branch-a"] }), { branchId: "branch-a" }));
  }
});

test("Module option scope includes only authorized branch and shared Courses", () => {
  assert.deepEqual(lmsModuleCourseWhere(actor(Role.SUPER_ADMIN)), {});
  assert.deepEqual(lmsModuleCourseWhere(actor(Role.BRANCH_ADMIN)), { course: { is: { branchId: { in: [] } } } });
  assert.deepEqual(lmsModuleCourseWhere(actor(Role.BRANCH_ADMIN, { branchIds: ["branch-a"] })), {
    course: { is: { OR: [{ branchId: { in: ["branch-a"] } }, { branchId: null }] } },
  });
  assert.deepEqual(lmsModuleCourseWhere(actor(Role.TEACHER, { branchIds: ["branch-a"] })), {
    course: { is: { OR: [{ branchId: { in: ["branch-a"] } }, { branchId: null }] } },
  });
});

test("Lesson list branch filters cannot escape assigned Branch Admin scope", () => {
  assert.deepEqual(lmsLessonBranchFilter(actor(Role.SUPER_ADMIN), "branch-b"), "branch-b");
  assert.deepEqual(lmsLessonBranchFilter(actor(Role.BRANCH_ADMIN, { branchIds: ["branch-a"] })), { in: ["branch-a"] });
  assert.equal(lmsLessonBranchFilter(actor(Role.BRANCH_ADMIN, { branchIds: ["branch-a"] }), "branch-a"), "branch-a");
  assert.throws(() => lmsLessonBranchFilter(actor(Role.BRANCH_ADMIN, { branchIds: ["branch-a"] }), "branch-b"));
  assert.deepEqual(lmsLessonBranchFilter(actor(Role.BRANCH_ADMIN)), { in: [] });
});

test("LMS routers authenticate management and constrain learner progress routes", () => {
  const source = readFileSync(new URL("../routes/admin-lms.ts", import.meta.url), "utf8");
  assert.match(source, /admin\.use\(requireAuth,\s*allow\(Role\.SUPER_ADMIN,\s*Role\.BRANCH_ADMIN,\s*Role\.TEACHER\),\s*requireCommercialFeature\("lms"\)\)/);
  assert.match(source, /router\.use\(requireAuth,\s*requireCommercialFeature\("lms"\)\)/);
  assert.match(source, /router\.patch\("\/lms\/lessons\/:id\/progress",\s*allow\(Role\.STUDENT\)/);
  assert.match(source, /router\.get\("\/lms\/me",\s*allow\(Role\.STUDENT\)/);
  assert.match(source, /assertLmsRequestContentAccess\(req,\s*lesson\)/);
  assert.match(source, /assertLmsRequestContentAccess\(req,\s*attachment\.lesson\)/);
  assert.match(source, /assertLmsModuleManagementAccess\(current,\s*course\)/);
  assert.match(source, /prisma\.module\.create\(\{\s*data\s*\}\)/);
  assert.doesNotMatch(source, /prisma\.module\.upsert/);
  assert.match(source, /MODULE_POSITION_CONFLICT/);
  assert.match(source, /module\.courseId !== data\.courseId\) throw new AppError\(422, "INVALID_MODULE_RELATION"/);
});

test("production server mounts only the LMS path before broad admin guards", () => {
  const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const scopedLms = 'app.use("/api/v1/admin", onlyPaths(["/lms"], adminLms));';
  const broadAcademicSessions = 'app.use("/api/v1/admin", adminAcademicSessions);';
  assert.ok(server.indexOf(scopedLms) >= 0);
  assert.ok(server.indexOf(scopedLms) < server.indexOf(broadAcademicSessions));
  assert.doesNotMatch(server, /app\.use\("\/api\/v1\/admin", adminLms\)/);
  assert.match(server, /adminAcademicSessions/);
});


test("LMS lessons follow a one-way draft-publish-archive lifecycle", () => {
  assert.equal(lmsLessonCreateStatus(), LmsContentStatus.DRAFT);
  assert.equal(lmsLessonCreateStatus(LmsContentStatus.DRAFT), LmsContentStatus.DRAFT);
  for (const status of [LmsContentStatus.PUBLISHED, LmsContentStatus.ARCHIVED]) {
    assert.throws(() => lmsLessonCreateStatus(status), /created as draft/);
  }
  assert.doesNotThrow(() => assertLmsLessonTransition(LmsContentStatus.DRAFT, LmsContentStatus.PUBLISHED));
  assert.doesNotThrow(() => assertLmsLessonTransition(LmsContentStatus.DRAFT, LmsContentStatus.ARCHIVED));
  assert.doesNotThrow(() => assertLmsLessonTransition(LmsContentStatus.PUBLISHED, LmsContentStatus.ARCHIVED));
  for (const [from, to] of [
    [LmsContentStatus.PUBLISHED, LmsContentStatus.DRAFT],
    [LmsContentStatus.ARCHIVED, LmsContentStatus.DRAFT],
    [LmsContentStatus.ARCHIVED, LmsContentStatus.PUBLISHED],
    [LmsContentStatus.DRAFT, LmsContentStatus.DRAFT],
    [LmsContentStatus.PUBLISHED, LmsContentStatus.PUBLISHED],
  ] as const) assert.throws(() => assertLmsLessonTransition(from, to), /cannot change/);
  assert.doesNotThrow(() => assertLmsLessonEditable(LmsContentStatus.DRAFT));
  assert.doesNotThrow(() => assertLmsLessonEditable(LmsContentStatus.PUBLISHED));
  assert.throws(() => assertLmsLessonEditable(LmsContentStatus.ARCHIVED), /cannot be edited/);
});

test("lesson academic context and duration lock after progress exists", () => {
  assert.doesNotThrow(() => assertLmsLessonStructuralEditAllowed(false, true));
  assert.doesNotThrow(() => assertLmsLessonStructuralEditAllowed(true, false));
  assert.throws(() => assertLmsLessonStructuralEditAllowed(true, true), /cannot change after student progress/);
});

test("student LMS progress is monotonic and server-derived", () => {
  const first = nextLmsProgress(null, { lastPositionSeconds: 120, timeSpentSeconds: 9999 }, 600, new Date("2026-09-20T00:00:00.000Z"));
  assert.deepEqual(first, {
    watchedSeconds: 120,
    watchPercentage: 20,
    lastPositionSeconds: 120,
    completed: false,
    completedAt: null,
    creditedTimeSeconds: 120,
  });
  const completedAt = new Date("2026-09-20T01:00:00.000Z");
  const existing = { watchedSeconds: 570, lastPositionSeconds: 570, completed: true, completedAt };
  const rewind = nextLmsProgress(existing, { lastPositionSeconds: 100, timeSpentSeconds: 1000 }, 600, new Date("2026-09-20T02:00:00.000Z"));
  assert.equal(rewind.watchedSeconds, 570);
  assert.equal(rewind.lastPositionSeconds, 570);
  assert.equal(rewind.completed, true);
  assert.equal(rewind.completedAt, completedAt);
  assert.equal(rewind.creditedTimeSeconds, 0);
});
