import assert from "node:assert/strict";
import test from "node:test";
import { Role } from "@prisma/client";
import { AppError } from "./http.js";
import { assertEnquiryCounsellorEligible } from "./enquiry-counsellor-policy.js";

test("tenant super admin counsellor is eligible for any branch", () => {
  assert.doesNotThrow(() => assertEnquiryCounsellorEligible({
    role: Role.SUPER_ADMIN,
    isActive: true,
    branchIds: [],
  }, "branch-a"));
});

test("branch admin counsellor is eligible only for assigned branches", () => {
  assert.doesNotThrow(() => assertEnquiryCounsellorEligible({
    role: Role.BRANCH_ADMIN,
    isActive: true,
    branchIds: ["branch-a"],
  }, "branch-a"));

  assert.throws(
    () => assertEnquiryCounsellorEligible({
      role: Role.BRANCH_ADMIN,
      isActive: true,
      branchIds: ["branch-b"],
    }, "branch-a"),
    (error: unknown) => error instanceof AppError && error.status === 422 && error.code === "COUNSELLOR_BRANCH_MISMATCH",
  );
});

test("inactive and non-admin counsellors are rejected", () => {
  for (const candidate of [
    { role: Role.BRANCH_ADMIN, isActive: false, branchIds: ["branch-a"] },
    { role: Role.TEACHER, isActive: true, branchIds: ["branch-a"] },
  ]) {
    assert.throws(
      () => assertEnquiryCounsellorEligible(candidate, "branch-a"),
      (error: unknown) => error instanceof AppError && error.status === 422 && error.code === "INVALID_COUNSELLOR",
    );
  }
});
