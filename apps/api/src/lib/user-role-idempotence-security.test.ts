import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Role } from "@prisma/client";
import { AppError } from "./http.js";
import { assertCanChangeUserRole, type ManagedUser, type UserAdministrator } from "./user-administration-policy.js";

const branchAdmin: UserAdministrator = {
  id: "ndg-admin", role: Role.BRANCH_ADMIN, branchIds: ["ndg"],
};
const target: ManagedUser = {
  id: "student-1", role: Role.STUDENT, isActive: true,
  branchIds: ["ndg"], hasStudentProfile: true, hasTeacherProfile: false,
  hasEmployeeProfile: false, hasParentLinks: false,
};
const rejectedWith = (code: string) => (error: unknown) =>
  error instanceof AppError && error.status === 403 && error.code === code;

test("idempotent role requests cannot reveal users in another branch", () => {
  assert.throws(
    () => assertCanChangeUserRole(branchAdmin, { ...target, branchIds: ["rne"] }, Role.STUDENT, 2),
    rejectedWith("USER_BRANCH_FORBIDDEN"),
  );
  assert.throws(
    () => assertCanChangeUserRole(branchAdmin, { ...target, branchIds: ["ndg", "rne"] }, Role.STUDENT, 2),
    rejectedWith("USER_BRANCH_FORBIDDEN"),
  );
  assert.throws(
    () => assertCanChangeUserRole(branchAdmin, { ...target, branchIds: [] }, Role.STUDENT, 2),
    rejectedWith("USER_BRANCH_FORBIDDEN"),
  );
});

test("idempotent role requests cannot confirm protected admin or self identities", () => {
  assert.throws(
    () => assertCanChangeUserRole(branchAdmin, { ...target, role: Role.BRANCH_ADMIN }, Role.BRANCH_ADMIN, 2),
    rejectedWith("ROLE_GRANT_FORBIDDEN"),
  );
  assert.throws(
    () => assertCanChangeUserRole(branchAdmin, { ...target, id: branchAdmin.id }, Role.STUDENT, 2),
    rejectedWith("SELF_PRIVILEGE_CHANGE_FORBIDDEN"),
  );
});

test("authorized same-role requests remain idempotent without a profile mutation", () => {
  assert.doesNotThrow(() => assertCanChangeUserRole(branchAdmin, target, Role.STUDENT, 2));
  assert.doesNotThrow(() => assertCanChangeUserRole(
    { id: "super-1", role: Role.SUPER_ADMIN, branchIds: [] },
    { ...target, role: Role.SUPER_ADMIN }, Role.SUPER_ADMIN, 1,
  ));
});

test("inactive users and accounting roles do not bypass role policy through no-op", () => {
  assert.throws(
    () => assertCanChangeUserRole(branchAdmin, { ...target, isActive: false }, Role.STUDENT, 2),
    (e: unknown) => e instanceof AppError && e.code === "INACTIVE_USER_ROLE_LOCKED",
  );
  assert.throws(
    () => assertCanChangeUserRole(branchAdmin, { ...target, role: Role.ACCOUNTANT }, Role.ACCOUNTANT, 2),
    rejectedWith("ACCOUNTANT_ROLE_FORBIDDEN"),
  );
});

test("admin role endpoint must invoke policy before acknowledging unchanged role", async () => {
  const source = await readFile(new URL("../routes/admin.ts", import.meta.url), "utf8");
  const route = source.indexOf('router.patch("/users/:id/role"');
  const early = source.indexOf("if (target.role === role)", route);
  const policy = source.indexOf("assertCanChangeUserRole(administrator, managedTarget, role, 0)", early);
  const response = source.indexOf("return res.json({ data: { id: target.id, role: target.role } })", early);
  assert.ok(route >= 0 && early > route && policy > early && response > policy);
});
