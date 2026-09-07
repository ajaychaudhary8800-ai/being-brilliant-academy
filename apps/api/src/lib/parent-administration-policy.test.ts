import test from "node:test";
import assert from "node:assert/strict";
import { AppError } from "./http.js";
import { assertEligibleParentStudent, assertParentBranchScope, isEligibleParentStudent } from "./parent-administration-policy.js";

test("parent eligibility requires an active student profile and active user", () => {
  assert.equal(isEligibleParentStudent({ status: "ACTIVE", user: { isActive: true } }), true);
  assert.equal(isEligibleParentStudent({ status: "INACTIVE", user: { isActive: true } }), false);
  assert.equal(isEligibleParentStudent({ status: "ACTIVE", user: { isActive: false } }), false);
  assert.throws(() => assertEligibleParentStudent({ status: "INACTIVE", user: { isActive: true } }), (error: unknown) => error instanceof AppError && error.code === "INVALID_STUDENT");
});

test("parent branch scope permits only assigned branches", () => {
  assert.doesNotThrow(() => assertParentBranchScope(["branch-a"], ["branch-a"]));
  assert.throws(() => assertParentBranchScope(["branch-a"], ["branch-b"]), (error: unknown) => error instanceof AppError && error.code === "BRANCH_FORBIDDEN");
  assert.doesNotThrow(() => assertParentBranchScope(null, ["branch-b"]));
});
