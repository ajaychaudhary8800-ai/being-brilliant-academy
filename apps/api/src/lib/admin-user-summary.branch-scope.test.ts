import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { Role } from "@prisma/client";
import { summarizeAdminUser } from "./admin-user-summary.js";

const NDG = { id: "ndg", branchCode: "NDG", branchName: "Nandgram" };
const RNE = { id: "rne", branchCode: "RNE", branchName: "Rajnagar Extension" };
const SHN = { id: "shn", branchCode: "SHN", branchName: "Shastri Nagar" };
const record = {
  id: "parent-user", name: "BBA Synthetic Parent", role: Role.PARENT, email: "parent@example.test",
  branchAssignments: [{ branch: NDG }, { branch: SHN }],
  studentProfile: { id: "shadow-student", admissionNo: "RNE_SECRET_ADMISSION", branch: RNE },
  teacherProfile: { id: "shadow-teacher", employeeNo: "RNE_SECRET_EMPLOYEE", branch: RNE },
  employee: { id: "shadow-employee", branch: SHN },
  parentChildren: [
    { relationship: "FATHER", student: { id: "ndg-student", admissionNo: "NDG100", user: { name: "NDG Student" }, status: "ACTIVE", branch: NDG, batch: { name: "NDG Batch", course: { title: "NDG Course" } } } },
    { relationship: "FATHER", student: { id: "rne-student", admissionNo: "RNE_SECRET_CHILD", user: { name: "RNE_PRIVATE_STUDENT" }, status: "ACTIVE", branch: RNE, batch: { name: "RNE Private Batch", course: { title: "RNE Private Course" } } } },
  ],
};

test("BBA NDG Branch Admin list response prunes every out-of-branch nested relation", () => {
  const projected = summarizeAdminUser(record, [NDG.id]);
  assert.deepEqual(projected.branches.map((b: any) => b.id), [NDG.id]);
  assert.deepEqual(projected.parentChildren.map((child: any) => child.admissionNo), ["NDG100"]);
  assert.deepEqual(projected.branchAssignments.map((b: any) => b.branch.id), [NDG.id]);
  assert.equal(projected.studentProfile, null);
  assert.equal(projected.teacherProfile, null);
  assert.equal(projected.employee, null);
  for (const secret of ["RNE_SECRET_CHILD", "RNE_PRIVATE_STUDENT", "RNE_SECRET_ADMISSION", "RNE_SECRET_EMPLOYEE", "RNE Private", '"id":"rne"', '"id":"shn"']) {
    assert.equal(JSON.stringify(projected).includes(secret), false, secret);
  }
});

test("BBA branch filtering never leaks neighboring campus through shared teacher assignments", () => {
  const teacher = {
    ...record,
    role: Role.TEACHER,
    studentProfile: null,
    employee: null,
    parentChildren: [],
    branchAssignments: [{ branch: NDG }, { branch: RNE }, { branch: SHN }],
    teacherProfile: { id: "teacher-rne", employeeNo: "RNE_SECRET_EMPLOYEE", branch: RNE },
  };
  const scoped = summarizeAdminUser(teacher, [NDG.id]);
  assert.deepEqual(scoped.branchAssignments.map((x: any) => x.branch.id), [NDG.id]);
  assert.equal(scoped.teacherProfile, null);
  assert.equal(scoped.linkedProfile, "TEACHER");
  assert.equal(JSON.stringify(scoped).includes("RNE_SECRET_EMPLOYEE"), false);
  assert.equal(JSON.stringify(scoped).includes('"id":"shn"'), false);
});

test("BBA SUPER_ADMIN sees complete existing nested relation information", () => {
  const full = summarizeAdminUser(record, null);
  assert.deepEqual(full.branches.map((b: any) => b.id), [NDG.id, SHN.id, RNE.id]);
  assert.deepEqual(full.parentChildren.map((child: any) => child.admissionNo), ["NDG100", "RNE_SECRET_CHILD"]);
  assert.equal(full.studentProfile.admissionNo, "RNE_SECRET_ADMISSION");
});

test("explicit branch filter scopes nested data even when requested by SUPER_ADMIN", () => {
  const one = summarizeAdminUser(record, [RNE.id]);
  assert.deepEqual(one.branches.map((b: any) => b.id), [RNE.id]);
  assert.deepEqual(one.parentChildren.map((child: any) => child.id), ["rne-student"]);
  assert.deepEqual(one.branchAssignments, []);
});

test("admin users-list always supplies the authorized branch filter to the serializer", async () => {
  const file = new URL("../routes/admin-users.ts", import.meta.url);
  const source = await readFile(file, "utf8");
  assert.match(source, /branchFilter = q\.branchId \? \[q\.branchId\] : allowed/);
  assert.match(source, /data\.map\(user => summarizeAdminUser\(user, branchFilter\)\)/);
});
