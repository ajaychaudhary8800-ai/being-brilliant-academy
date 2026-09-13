import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, StudentAcademicEnrollmentSource, StudentAcademicEnrollmentStatus } from "@prisma/client";
import { academicPlacementConflict, assertAcademicProjectionConsistent, cancelAcademicEnrollment, closeActiveAcademicEnrollment, createActiveAcademicEnrollment, normalizeAcademicRollNumber, resolveAuthoritativeBatchTuple, resolveHistoricalAcademicEnrollment } from "./academic-placement.js";
import { AppError } from "./http.js";

const organizationId = "org-academic-placement";
const batch = {
  id: "batch-1", organizationId, branchId: "branch-1", courseId: "course-1", academicSessionId: "session-1", capacity: 30,
  branch: { id: "branch-1", branchName: "Main", branchCode: "MAIN" },
  course: { id: "course-1", title: "Class 10", courseCode: "CLASS-10" },
  session: { id: "session-1", name: "2026-27", startsAt: new Date("2026-04-01"), endsAt: new Date("2027-03-31"), isArchived: false },
};

test("authoritative Batch resolution treats client placement fields only as assertions", async () => {
  const db = { batch: { findFirst: async () => batch } } as any;
  const resolved = await resolveAuthoritativeBatchTuple(db, { organizationId, batchId: batch.id, assertedBranchId: batch.branchId, assertedAcademicSession: " 2026-27 ", requireCourse: true });
  assert.equal(resolved.course?.title, "Class 10");
  await assert.rejects(resolveAuthoritativeBatchTuple(db, { organizationId, batchId: batch.id, assertedBranchId: "wrong" }), (error: AppError) => error.code === "BATCH_BRANCH_MISMATCH" && error.status === 422);
  await assert.rejects(resolveAuthoritativeBatchTuple(db, { organizationId, batchId: batch.id, assertedAcademicSession: "2025-26" }), (error: AppError) => error.code === "BATCH_SESSION_MISMATCH" && error.status === 422);
  await assert.rejects(resolveAuthoritativeBatchTuple({ batch: { findFirst: async () => ({ ...batch, courseId: null, course: null }) } } as any, { organizationId, batchId: batch.id, requireCourse: true }), (error: AppError) => error.code === "BATCH_COURSE_REQUIRED" && error.status === 422);
});

test("roll normalization and enrollment creation share one canonical representation", async () => {
  let created: any;
  const db = { studentAcademicEnrollment: { create: async ({ data }: any) => { created = data; return data; } } } as any;
  assert.equal(normalizeAcademicRollNumber("  ab-12 "), "AB-12");
  await createActiveAcademicEnrollment(db, { organizationId, studentId: "student-1", academicSessionId: "session-1", branchId: "branch-1", courseId: "course-1", batchId: "batch-1", rollNo: "  ab-12 ", source: StudentAcademicEnrollmentSource.ADMISSION, effectiveFrom: new Date("2026-04-01"), createdById: "admin-1" });
  assert.equal(created.rollNo, "AB-12");
  assert.equal(created.status, StudentAcademicEnrollmentStatus.ACTIVE);
  assert.equal(created.effectiveTo, null);
  await assert.rejects(async () => createActiveAcademicEnrollment(db, { organizationId, studentId: "student-2", academicSessionId: "session-1", branchId: "branch-1", courseId: "course-1", batchId: "batch-1", rollNo: "2", source: StudentAcademicEnrollmentSource.BACKFILL, effectiveFrom: new Date("2026-04-01"), createdById: "admin-1" }), (error: AppError) => error.code === "ACADEMIC_PLACEMENT_INCONSISTENT");
});

test("closing an enrollment preserves civil-date history without inferring cancellation", async () => {
  const updates: any[] = [];
  const db = { studentAcademicEnrollment: { update: async (args: any) => { updates.push(args); return args.data; } } } as any;
  const enrollment = { id: "enrollment-1", organizationId, effectiveFrom: new Date("2026-04-01") };
  await closeActiveAcademicEnrollment(db, enrollment, new Date("2026-04-02"));
  assert.deepEqual(updates[0].data, { status: StudentAcademicEnrollmentStatus.CLOSED, effectiveTo: new Date("2026-04-02") });
  await closeActiveAcademicEnrollment(db, enrollment, new Date("2026-04-01"));
  assert.deepEqual(updates[1].data, { status: StudentAcademicEnrollmentStatus.CLOSED, effectiveTo: new Date("2026-04-01") });
  assert.notEqual(updates[1].data.status, StudentAcademicEnrollmentStatus.CANCELLED);
  await assert.rejects(closeActiveAcademicEnrollment(db, enrollment, new Date("2026-03-31")), (error: AppError) => error.code === "ACADEMIC_PLACEMENT_INCONSISTENT");
  await cancelAcademicEnrollment(db, enrollment);
  assert.deepEqual(updates[2].data, { status: StudentAcademicEnrollmentStatus.CANCELLED, effectiveTo: new Date("2026-04-01") });
});

test("projection consistency and uniqueness failures use stable academic codes", () => {
  assert.doesNotThrow(() => assertAcademicProjectionConsistent({ branchId: "branch-1", batchId: "batch-1", academicSessionId: "session-1", rollNo: " 1 " }, { branchId: "branch-1", batchId: "batch-1", academicSessionId: "session-1", rollNo: "1" }));
  assert.throws(() => assertAcademicProjectionConsistent({ branchId: "branch-2", batchId: "batch-1", academicSessionId: "session-1", rollNo: "1" }, { branchId: "branch-1", batchId: "batch-1", academicSessionId: "session-1", rollNo: "1" }), (error: AppError) => error.code === "ACADEMIC_PLACEMENT_INCONSISTENT");
  const studentConflict = new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test", meta: { target: ["organizationId", "studentId"] } });
  const rollConflict = new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test", meta: { target: ["organizationId", "batchId", "upper(btrim(rollNo))"] } });
  assert.equal(academicPlacementConflict(studentConflict)?.code, "ACADEMIC_ENROLLMENT_EXISTS");
  assert.equal(academicPlacementConflict(rollConflict)?.code, "ACADEMIC_ENROLLMENT_CONFLICT");
});

test("historical enrollment resolution keeps half-open dates and explicit context priority", async () => {
  const rows = [
    { id: "old", organizationId, studentId: "student-1", branchId: "branch-1", academicSessionId: "session-1", courseId: "course-1", batchId: "batch-1", status: StudentAcademicEnrollmentStatus.CLOSED, effectiveFrom: new Date("2026-04-01"), effectiveTo: new Date("2027-04-01"), createdAt: new Date("2026-04-01"), course: null, academicSession: null, branch: null, batch: null, createdBy: null },
    { id: "current", organizationId, studentId: "student-1", branchId: "branch-1", academicSessionId: "session-1", courseId: "course-1", batchId: "batch-2", status: StudentAcademicEnrollmentStatus.ACTIVE, effectiveFrom: new Date("2027-04-01"), effectiveTo: null, createdAt: new Date("2027-04-01"), course: null, academicSession: null, branch: null, batch: null, createdBy: null },
  ];
  const db = { studentAcademicEnrollment: { findMany: async () => rows } } as any;
  assert.equal((await resolveHistoricalAcademicEnrollment(db, { organizationId, studentId: "student-1", batchId: "batch-1", onDate: new Date("2027-03-31"), mode: "HISTORICAL_READ" }))?.id, "old");
  assert.equal((await resolveHistoricalAcademicEnrollment(db, { organizationId, studentId: "student-1", batchId: "batch-2", onDate: new Date("2027-04-01"), mode: "CURRENT_OR_NEW_WRITE" }))?.id, "current");
  assert.equal((await resolveHistoricalAcademicEnrollment(db, { organizationId, studentId: "student-1", onDate: new Date("2027-04-01"), mode: "HISTORICAL_READ" }))?.id, "current");
});

test("same-day CLOSED evidence requires explicit context and cancelled rows never qualify", async () => {
  const sameDay = { id: "same-day", organizationId, studentId: "student-2", branchId: "branch-1", academicSessionId: "session-1", courseId: "course-1", batchId: "batch-1", status: StudentAcademicEnrollmentStatus.CLOSED, effectiveFrom: new Date("2027-04-01"), effectiveTo: new Date("2027-04-01"), createdAt: new Date("2027-04-01"), course: null, academicSession: null, branch: null, batch: null, createdBy: null };
  const cancelled = { ...sameDay, id: "cancelled", status: StudentAcademicEnrollmentStatus.CANCELLED };
  const db = { studentAcademicEnrollment: { findMany: async () => [sameDay, cancelled] } } as any;
  assert.equal((await resolveHistoricalAcademicEnrollment(db, { organizationId, studentId: "student-2", batchId: "batch-1", onDate: new Date("2027-04-01"), mode: "HISTORICAL_CORRECTION" }))?.id, "same-day");
  await assert.rejects(resolveHistoricalAcademicEnrollment(db, { organizationId, studentId: "student-2", onDate: new Date("2027-04-01"), mode: "CURRENT_OR_NEW_WRITE" }), (error: AppError) => error.code === "ACADEMIC_ENROLLMENT_AMBIGUOUS");
});

test("current backfill does not invalidate an older legacy context", async () => {
  const currentBackfill = { id: "backfill-b", organizationId, studentId: "legacy-student", branchId: "branch-1", academicSessionId: "session-2", courseId: "course-2", batchId: "batch-b", status: StudentAcademicEnrollmentStatus.ACTIVE, effectiveFrom: new Date("2027-04-01"), effectiveTo: null, createdAt: new Date("2027-04-01"), source: StudentAcademicEnrollmentSource.BACKFILL, course: null, academicSession: null, branch: null, batch: null, createdBy: null };
  const db = { studentAcademicEnrollment: { findMany: async () => [currentBackfill] } } as any;
  const context = { organizationId, studentId: "legacy-student", branchId: "branch-1", academicSessionId: "session-1", courseId: "course-1", batchId: "batch-a", onDate: new Date("2026-10-01") };
  assert.equal(await resolveHistoricalAcademicEnrollment(db, { ...context, mode: "HISTORICAL_READ" }), null);
  assert.equal(await resolveHistoricalAcademicEnrollment(db, { ...context, mode: "HISTORICAL_CORRECTION" }), null);
  await assert.rejects(resolveHistoricalAcademicEnrollment(db, { ...context, mode: "CURRENT_OR_NEW_WRITE" }), (error: AppError) => error.code === "ACADEMIC_HISTORY_CONTEXT_MISMATCH");
  const crossTenant = { studentAcademicEnrollment: { findMany: async () => [{ ...currentBackfill, organizationId: "other-organization" }] } } as any;
  assert.equal(await resolveHistoricalAcademicEnrollment(crossTenant, { ...context, mode: "HISTORICAL_READ" }), null);
});
