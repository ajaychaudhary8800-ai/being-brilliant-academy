import assert from "node:assert/strict";
import test from "node:test";
import { Role } from "@prisma/client";
import { AppError } from "./http.js";
import { validateExistingBranchManagerAssignment } from "./branch-manager-assignment.js";

const org = "org_bba_uat";
const branch = { id: "branch_ndg", organizationId: org, isActive: true };
const requestedEmail = "ndg-manager@controlled.example";
const manager = { id: "manager_ndg", organizationId: org, role: Role.BRANCH_ADMIN, isActive: true, email: requestedEmail };

function check(input: Partial<Parameters<typeof validateExistingBranchManagerAssignment>[0]> = {}) {
  return validateExistingBranchManagerAssignment({
    organizationId: org,
    branch,
    requestedEmail,
    currentManagers: [],
    candidate: null,
    ...input,
  });
}
function rejects(code: string, input: Parameters<typeof check>[0]) {
  assert.throws(() => check(input), (err: unknown) =>
    err instanceof AppError && err.code === code);
}

test("new manager on valid unassigned BBA branch is eligible", () => {
  assert.equal(check(), "CREATE_NEW");
});

test("same tenant active branch admin can be attached, never promoted from student or teacher", () => {
  assert.equal(check({ candidate: manager }), "ASSIGN_EXISTING");
  rejects("MANAGER_EMAIL_EXISTS", { candidate: { ...manager, role: Role.TEACHER } });
  rejects("MANAGER_EMAIL_EXISTS", { candidate: { ...manager, role: Role.STUDENT } });
  rejects("MANAGER_EMAIL_EXISTS", { candidate: { ...manager, role: Role.SUPER_ADMIN } });
  rejects("MANAGER_EMAIL_EXISTS", { candidate: { ...manager, organizationId: "foreign_tenant" } });
  rejects("MANAGER_ACCOUNT_INACTIVE", { candidate: { ...manager, isActive: false } });
});

test("appointment to another tenant or inactive branch is rejected", () => {
  rejects("BRANCH_NOT_FOUND", { branch: null });
  rejects("BRANCH_NOT_FOUND", { branch: { ...branch, organizationId: "foreign_tenant" } });
  rejects("INACTIVE_BRANCH_MANAGER_PROHIBITED", { branch: { ...branch, isActive: false } });
});

test("existing manager assignment is idempotent only for the identical manager email", () => {
  assert.equal(check({ currentManagers: [manager] }), "ALREADY_ASSIGNED");
  rejects("BRANCH_MANAGER_ALREADY_ASSIGNED", {
    requestedEmail: "replacement@controlled.example",
    currentManagers: [manager],
  });
  rejects("BRANCH_MANAGER_CONFLICT", { currentManagers: [manager, { ...manager, id: "another" }] });
  rejects("BRANCH_MANAGER_CONFLICT", { currentManagers: [{ ...manager, role: Role.STUDENT }] });
  rejects("BRANCH_MANAGER_CONFLICT", { currentManagers: [{ ...manager, organizationId: "foreign_tenant" }] });
  rejects("BRANCH_MANAGER_CONFLICT", { currentManagers: [{ ...manager, isActive: false }] });
});

test("new candidate cannot override an existing manager, even if new email is valid", () => {
  rejects("BRANCH_MANAGER_ALREADY_ASSIGNED", {
    requestedEmail: "new-manager@controlled.example",
    candidate: { ...manager, id: "new", email: "new-manager@controlled.example" },
    currentManagers: [manager],
  });
});
