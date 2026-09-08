import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "./http.js";
import { assertParentLeaveStudentAuthorized, isLegacyParentLeave, leaveDecisionRecipient, type ParentLeaveStudent } from "./parent-leave-policy.js";

const eligible: ParentLeaveStudent = {
  organizationId: "org-a",
  status: "ACTIVE",
  branchId: "branch-a",
  batchId: "batch-a",
  user: { id: "student-user", name: "Student", organizationId: "org-a", isActive: true },
  branch: { organizationId: "org-a" },
  session: { startsAt: new Date("2026-04-01T00:00:00.000Z"), endsAt: new Date("2027-03-31T00:00:00.000Z") },
};

test("parent leave accepts only an active same-tenant student and branch", () => {
  assert.equal(assertParentLeaveStudentAuthorized(eligible, "org-a"), eligible);
  for (const student of [
    null,
    { ...eligible, organizationId: "org-b" },
    { ...eligible, status: "INACTIVE" },
    { ...eligible, user: { ...eligible.user, organizationId: "org-b" } },
    { ...eligible, user: { ...eligible.user, isActive: false } },
    { ...eligible, branch: { organizationId: "org-b" } },
  ]) {
    assert.throws(
      () => assertParentLeaveStudentAuthorized(student, "org-a"),
      (error: unknown) => error instanceof AppError && error.status === 403 && error.code === "STUDENT_NOT_AVAILABLE",
    );
  }
});

test("decisions notify a guardian submitter and otherwise the leave subject", () => {
  assert.equal(leaveDecisionRecipient("student-user", "parent-user"), "parent-user");
  assert.equal(leaveDecisionRecipient("student-user", null), "student-user");
});

test("only historical parent-subject rows are marked as ambiguous", () => {
  assert.equal(isLegacyParentLeave("PARENT", null), true);
  assert.equal(isLegacyParentLeave("PARENT", "parent-user"), false);
  assert.equal(isLegacyParentLeave("STUDENT", null), false);
});
