import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Role } from "@prisma/client";
import { assertLmsContentAccess, assertLmsManagementAccess, type LmsActor } from "./lms-policy.js";

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

test("LMS routers authenticate management and constrain learner progress routes", () => {
  const source = readFileSync(new URL("../routes/admin-lms.ts", import.meta.url), "utf8");
  assert.match(source, /admin\.use\(requireAuth,allow\(Role\.SUPER_ADMIN,Role\.BRANCH_ADMIN,Role\.TEACHER\)\)/);
  assert.match(source, /router\.patch\("\/lms\/lessons\/:id\/progress",allow\(Role\.STUDENT\)/);
  assert.match(source, /router\.get\("\/lms\/me",allow\(Role\.STUDENT\)/);
  assert.match(source, /await view\(req,x\.lesson\)/);
});
