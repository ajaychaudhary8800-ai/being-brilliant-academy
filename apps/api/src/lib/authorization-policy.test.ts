import assert from "node:assert/strict";
import test from "node:test";
import { Role } from "@prisma/client";
import { announcementRecipientConstraints, circularRecipientConstraints, eventRecipientConstraints } from "./communication-authorization.js";
import { assertMessageRecipientAuthorized, type MessageParticipant } from "./message-policy.js";
import { assertCanAdministerUserTarget, assertCanChangeUserRole, managedUserBranchIds, type ManagedUser } from "./user-administration-policy.js";

const user = (values: Partial<ManagedUser> = {}): ManagedUser => ({
  id: "target",
  role: Role.STUDENT,
  isActive: true,
  branchIds: ["branch-a"],
  hasStudentProfile: true,
  hasTeacherProfile: false,
  hasEmployeeProfile: false,
  hasParentLinks: false,
  ...values,
});

const errorCode = (cause: unknown) => (cause as { code?: string }).code;

test("branch administrators cannot grant administrator roles or change themselves", () => {
  const actor = { id: "admin", role: Role.BRANCH_ADMIN, branchIds: ["branch-a"] } as const;
  assert.throws(() => assertCanChangeUserRole(actor, user(), Role.SUPER_ADMIN, 2), cause => errorCode(cause) === "ROLE_GRANT_FORBIDDEN");
  assert.throws(() => assertCanChangeUserRole({ ...actor, id: "target" }, user(), Role.TEACHER, 2), cause => errorCode(cause) === "SELF_PRIVILEGE_CHANGE_FORBIDDEN");
});

test("only super administrators may grant or remove the Accountant role", () => {
  assert.throws(() => assertCanChangeUserRole(
    { id: "admin", role: Role.BRANCH_ADMIN, branchIds: ["branch-a"] },
    user(),
    Role.ACCOUNTANT,
    2,
  ), cause => errorCode(cause) === "ROLE_GRANT_FORBIDDEN");
  assert.doesNotThrow(() => assertCanChangeUserRole(
    { id: "admin", role: Role.SUPER_ADMIN, branchIds: [] },
    user(),
    Role.ACCOUNTANT,
    2,
  ));
  assert.throws(() => assertCanChangeUserRole(
    { id: "admin", role: Role.BRANCH_ADMIN, branchIds: ["branch-a"] },
    user({ role: Role.ACCOUNTANT, branchIds: ["branch-a"] }),
    Role.STUDENT,
    2,
  ), cause => errorCode(cause) === "ACCOUNTANT_ROLE_FORBIDDEN");
});

test("same-branch Accountant identity, credentials and lifecycle remain Super Admin managed", () => {
  const protectedOperations = [
    "edit metadata",
    "change email",
    "deactivate",
    "activate",
    "change role",
    "assign branches",
    "revoke branches",
    "send setup email",
  ];
  for (const operation of protectedOperations) {
    assert.throws(
      () => assertCanAdministerUserTarget(Role.BRANCH_ADMIN, Role.ACCOUNTANT),
      cause => errorCode(cause) === "ACCOUNTANT_ROLE_FORBIDDEN",
      `Branch Admin must not ${operation} for a same-branch Accountant`,
    );
  }
  assert.doesNotThrow(() => assertCanAdministerUserTarget(Role.SUPER_ADMIN, Role.ACCOUNTANT));
  assert.doesNotThrow(() => assertCanAdministerUserTarget(Role.BRANCH_ADMIN, Role.STUDENT));
});

test("Accountant role administration rejects same-role and removal requests from Branch Admin", () => {
  const actor = { id: "admin", role: Role.BRANCH_ADMIN, branchIds: ["branch-a"] } as const;
  const accountant = user({ role: Role.ACCOUNTANT, branchIds: ["branch-a"] });
  assert.throws(
    () => assertCanChangeUserRole(actor, accountant, Role.ACCOUNTANT, 2),
    cause => errorCode(cause) === "ACCOUNTANT_ROLE_FORBIDDEN",
  );
  assert.throws(
    () => assertCanChangeUserRole(actor, accountant, Role.STUDENT, 2),
    cause => errorCode(cause) === "ACCOUNTANT_ROLE_FORBIDDEN",
  );
  assert.doesNotThrow(() => assertCanChangeUserRole(
    { id: "super", role: Role.SUPER_ADMIN, branchIds: [] },
    accountant,
    Role.ACCOUNTANT,
    2,
  ));
});

test("branch administrators cannot change users outside their assigned branches", () => {
  assert.throws(() => assertCanChangeUserRole(
    { id: "admin", role: Role.BRANCH_ADMIN, branchIds: ["branch-a"] },
    user({ branchIds: ["branch-b"] }),
    Role.TEACHER,
    2,
  ), cause => errorCode(cause) === "USER_BRANCH_FORBIDDEN");
});

test("super administrators can make compatible role changes and cannot remove the last super administrator", () => {
  assert.doesNotThrow(() => assertCanChangeUserRole(
    { id: "admin", role: Role.SUPER_ADMIN, branchIds: [] },
    user({ role: Role.STUDENT, hasTeacherProfile: true }),
    Role.TEACHER,
    1,
  ));
  assert.throws(() => assertCanChangeUserRole(
    { id: "admin", role: Role.SUPER_ADMIN, branchIds: [] },
    user({ role: Role.SUPER_ADMIN, hasStudentProfile: false }),
    Role.BRANCH_ADMIN,
    1,
  ), cause => errorCode(cause) === "LAST_SUPER_ADMIN_PROTECTED");
});

test("role changes require an active compatible profile", () => {
  assert.throws(() => assertCanChangeUserRole(
    { id: "admin", role: Role.SUPER_ADMIN, branchIds: [] },
    user({ hasTeacherProfile: false }),
    Role.TEACHER,
    2,
  ), cause => errorCode(cause) === "ROLE_PROFILE_CONFLICT");
  assert.throws(() => assertCanChangeUserRole(
    { id: "admin", role: Role.SUPER_ADMIN, branchIds: [] },
    user({ isActive: false }),
    Role.TEACHER,
    2,
  ), cause => errorCode(cause) === "INACTIVE_USER_ROLE_LOCKED");
});

test("managed user branches include profiles, assignments and linked children", () => {
  assert.deepEqual(managedUserBranchIds({
    branchAssignments: [{ branchId: "branch-a" }],
    studentProfile: { branchId: "branch-b" },
    teacherProfile: null,
    employee: { branchId: "branch-c" },
    parentChildren: [{ student: { branchId: "branch-d" } }],
  }), ["branch-a", "branch-b", "branch-c", "branch-d"]);
});

const participant = (id: string, role: Role, values: Partial<MessageParticipant> = {}): MessageParticipant => ({
  id,
  organizationId: "org-a",
  role,
  isActive: true,
  teacherId: null,
  studentBatchId: null,
  childBatchIds: [],
  branchIds: [],
  ...values,
});

test("message policy preserves assigned student-teacher and linked-parent communication", async () => {
  const participants = [
    participant("teacher", Role.TEACHER, { teacherId: "teacher-profile" }),
    participant("student", Role.STUDENT, { studentBatchId: "batch-a" }),
    participant("parent", Role.PARENT, { childBatchIds: ["batch-a"] }),
    participant("unrelated", Role.STUDENT, { studentBatchId: "batch-b" }),
  ];
  const store = {
    participant: async (id: string) => participants.find(item => item.id === id) ?? null,
    teacherBatchIds: async () => ["batch-a"],
  };
  const sender = { userId: "teacher", role: Role.TEACHER, organizationId: "org-a" };
  await assert.doesNotReject(assertMessageRecipientAuthorized(sender, "student", store));
  await assert.doesNotReject(assertMessageRecipientAuthorized(sender, "parent", store));
  await assert.rejects(assertMessageRecipientAuthorized(sender, "unrelated", store), cause => errorCode(cause) === "RECIPIENT_NOT_AVAILABLE");
});

test("message policy hides cross-tenant and inactive recipients", async () => {
  const store = {
    participant: async (id: string) => id === "other-org"
      ? participant(id, Role.STUDENT, { organizationId: "org-b" })
      : id === "inactive" ? participant(id, Role.STUDENT, { studentBatchId: "batch-a", isActive: false }) : participant(id, Role.TEACHER, { teacherId: "teacher" }),
    teacherBatchIds: async () => ["batch-a"],
  };
  const sender = { userId: "sender", role: Role.SUPER_ADMIN, organizationId: "org-a" };
  await assert.rejects(assertMessageRecipientAuthorized(sender, "other-org", store), cause => errorCode(cause) === "RECIPIENT_NOT_AVAILABLE");
  await assert.rejects(assertMessageRecipientAuthorized(sender, "inactive", store), cause => errorCode(cause) === "RECIPIENT_NOT_AVAILABLE");
});

test("communication recipient constraints include audience, branch, batch and publication windows", () => {
  const now = new Date("2026-09-10T00:00:00.000Z");
  const where = announcementRecipientConstraints({ role: Role.STUDENT, branchIds: ["branch-a"], batchIds: ["batch-a"] }, now);
  assert.deepEqual(where.AND, [
    { OR: [{ audience: null }, { audience: Role.STUDENT }] },
    { OR: [{ branchId: null }, { branchId: { in: ["branch-a"] } }] },
    { OR: [{ batchId: null }, { batchId: { in: ["batch-a"] } }] },
    { publishedAt: { lte: now } },
    { OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }] },
    { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
  ]);
  assert.equal((circularRecipientConstraints({ role: Role.TEACHER, branchIds: ["branch-a"], batchIds: [] }, now).AND as unknown[]).length, 4);
  assert.equal((eventRecipientConstraints({ role: Role.PARENT, branchIds: ["branch-a"], batchIds: ["batch-a"] }).AND as unknown[]).length, 4);
});
