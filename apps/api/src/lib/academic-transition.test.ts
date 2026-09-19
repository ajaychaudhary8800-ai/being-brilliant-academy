import assert from "node:assert/strict";
import test from "node:test";
import { StudentAcademicEnrollmentStatus } from "@prisma/client";
import { transitionStudentAcademicPlacement } from "./academic-placement.js";
import { AppError } from "./http.js";

const org = "org-transition-test";
const source = { id: "enrollment-source", organizationId: org, studentId: "student-1", branchId: "branch-a", courseId: "course-8", batchId: "batch-a", academicSessionId: "session-a", rollNo: "18", status: StudentAcademicEnrollmentStatus.ACTIVE, effectiveFrom: new Date("2026-04-01"), effectiveTo: null, createdAt: new Date("2026-04-01"), course: { id: "course-8", title: "Class 8" }, academicSession: { id: "session-a", name: "2026-27" }, branch: { id: "branch-a", branchName: "A" }, batch: { id: "batch-a", name: "A" }, createdBy: null };
const target = { id: "batch-b", organizationId: org, branchId: "branch-b", courseId: "course-9", academicSessionId: "session-b", capacity: 30, branch: { id: "branch-b", branchName: "B" }, course: { id: "course-9", title: "Class 9" }, session: { id: "session-b", name: "2027-28", startsAt: new Date("2027-04-01"), endsAt: new Date("2028-03-31"), isArchived: false } };

function fakeClient(activeRows: any[] = [source], batch = target) {
  const updates: any[] = [];
  const tx: any = {
    studentProfile: {
      findFirst: async () => ({ id: "student-1", status: "ACTIVE", branchId: source.branchId, batchId: source.batchId, academicSessionId: source.academicSessionId, rollNo: source.rollNo }),
      count: async () => 0,
      update: async (args: any) => { updates.push(args); return args.data; },
    },
    studentAcademicEnrollment: {
      findMany: async () => activeRows,
      count: async () => 0,
      updateMany: async (args: any) => { updates.push(args); return { count: 1 }; },
      create: async ({ data }: any) => ({ ...data, id: "enrollment-destination", status: "ACTIVE", effectiveTo: null }),
    },
    batch: { findFirst: async () => batch },
    branch: { findFirst: async () => ({ id: batch.branchId }) },
    studentAcademicTransition: { create: async ({ data }: any) => ({ ...data, id: "transition-1" }) },
    auditLog: { create: async () => ({}) },
  };
  return { updates, $transaction: async (work: any) => work(tx) } as any;
}

test("promotion closes source, creates destination and projects the target atomically", async () => {
  const client = fakeClient();
  const result = await transitionStudentAcademicPlacement(client, { organizationId: org, studentId: "student-1", type: "PROMOTED", effectiveDate: new Date("2027-04-01"), targetBatchId: target.id, rollNo: "07", createdById: "admin-1" });
  assert.equal(result.source.id, source.id);
  assert.equal(result.destination?.rollNo, "07");
  assert.equal(result.transition.type, "PROMOTED");
  assert.equal(client.updates.length, 2);
  assert.equal(client.updates[0].data.status, "CLOSED");
  assert.equal(client.updates[1].data.batchId, target.id);
});

test("transition rejects missing or ambiguous active placement without guessing", async () => {
  await assert.rejects(transitionStudentAcademicPlacement(fakeClient([]), { organizationId: org, studentId: "student-1", type: "LEFT", effectiveDate: new Date("2027-04-01"), createdById: "admin-1" }), (error: AppError) => error.code === "NO_ACTIVE_ACADEMIC_ENROLLMENT");
  await assert.rejects(transitionStudentAcademicPlacement(fakeClient([source, { ...source, id: "enrollment-2" }]), { organizationId: org, studentId: "student-1", type: "LEFT", effectiveDate: new Date("2027-04-01"), createdById: "admin-1" }), (error: AppError) => error.code === "ACADEMIC_ENROLLMENT_INTEGRITY_ERROR");
  await assert.rejects(transitionStudentAcademicPlacement(fakeClient(), { organizationId: org, studentId: "student-1", type: "PROMOTED", effectiveDate: new Date("2026-03-31"), targetBatchId: target.id, rollNo: "07", createdById: "admin-1" }), (error: AppError) => error.code === "INVALID_TRANSITION_DATE");
});

test("retention, transfer, left and graduated preserve the lifecycle invariants", async () => {
  const retainedTarget = { ...target, courseId: source.courseId, course: source.course, branchId: source.branchId };
  const retained = await transitionStudentAcademicPlacement(fakeClient([source], retainedTarget), { organizationId: org, studentId: source.studentId, type: "RETAINED", effectiveDate: new Date("2027-04-01"), targetBatchId: retainedTarget.id, rollNo: "19", createdById: "admin-1", authorizedBranchIds: [source.branchId] });
  assert.equal(retained.transition.type, "RETAINED");
  const transferred = await transitionStudentAcademicPlacement(fakeClient(), { organizationId: org, studentId: source.studentId, type: "TRANSFERRED", effectiveDate: new Date("2027-04-01"), targetBatchId: target.id, rollNo: "07", createdById: "admin-1", authorizedBranchIds: [source.branchId, target.branchId] });
  assert.equal(transferred.destination?.branchId, target.branchId);
  const leftClient = fakeClient();
  const left = await transitionStudentAcademicPlacement(leftClient, { organizationId: org, studentId: source.studentId, type: "LEFT", effectiveDate: new Date("2027-04-01"), createdById: "admin-1" });
  assert.equal(left.destination, null);
  assert.equal(leftClient.updates.filter((update: any) => update.data?.status === "INACTIVE").length, 1);
  assert.equal(leftClient.updates.filter((update: any) => update.data?.status === "CLOSED").length, 1);
  const graduatedClient = fakeClient();
  const graduated = await transitionStudentAcademicPlacement(graduatedClient, { organizationId: org, studentId: source.studentId, type: "GRADUATED", effectiveDate: new Date("2027-04-01"), createdById: "admin-1" });
  assert.equal(graduated.transition.toEnrollmentId, null);
  assert.equal(graduatedClient.updates.filter((update: any) => update.data?.status === "INACTIVE").length, 1);
});
