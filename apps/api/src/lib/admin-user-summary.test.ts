import assert from "node:assert/strict";
import test from "node:test";
import { Role } from "@prisma/client";
import { summarizeAdminUser } from "./admin-user-summary.js";

const base = { id: "user-1", name: "Admin", email: "admin@example.com", phone: null, isActive: true, createdAt: new Date(0), branchAssignments: [], studentProfile: null, teacherProfile: null, employee: null, parentChildren: [] };

test("a user without profiles or branches produces an empty branch summary", () => {
  const result = summarizeAdminUser({ ...base, role: Role.SUPER_ADMIN });
  assert.deepEqual(result.branches, []);
  assert.deepEqual(result.parentChildren, []);
});

test("branch summaries contain only valid unique branch objects", () => {
  const branch = { id: "branch-1", branchCode: "MAIN", branchName: "Main Branch" };
  const result = summarizeAdminUser({ ...base, role: Role.STUDENT, branchAssignments: [{ branch }], studentProfile: { branch } });
  assert.deepEqual(result.branches, [branch]);
  assert.equal(result.linkedProfile, "STUDENT");
});

test("parents without children and employees with optional data remain renderable", () => {
  assert.deepEqual(summarizeAdminUser({ ...base, role: Role.PARENT }).parentChildren, []);
  assert.equal(summarizeAdminUser({ ...base, role: Role.EMPLOYEE }).linkedProfile, null);
});
