import {
  Prisma,
  PrismaClient,
  StudentAcademicEnrollmentSource,
  StudentAcademicEnrollmentStatus,
} from "@prisma/client";
import { AppError } from "./http.js";

export type AcademicPlacementDb = Prisma.TransactionClient | PrismaClient;

export async function runSerializableAcademicPlacement<Authorization, Result>(
  client: PrismaClient,
  authorize: (tx: Prisma.TransactionClient) => Promise<Authorization>,
  work: (tx: Prisma.TransactionClient, authorization: Authorization) => Promise<Result>,
  maxAttempts = 3,
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await client.$transaction(async tx => work(tx, await authorize(tx)), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const retryable = Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2034");
      if (!retryable) throw error;
      if (attempt === maxAttempts) {
        throw new AppError(409, "ACADEMIC_ENROLLMENT_CONFLICT", "The academic placement changed; reload and try again");
      }
    }
  }
  throw new AppError(409, "ACADEMIC_ENROLLMENT_CONFLICT", "The academic placement changed; reload and try again");
}

export const academicEnrollmentInclude = {
  academicSession: { select: { id: true, name: true, startsAt: true, endsAt: true } },
  branch: { select: { id: true, branchName: true, branchCode: true } },
  course: { select: { id: true, title: true, courseCode: true } },
  batch: { select: { id: true, name: true, code: true } },
  createdBy: { select: { id: true, name: true } },
} as const;

export function normalizeAcademicRollNumber(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!normalized || normalized.length > 30) {
    throw new AppError(422, "ACADEMIC_PLACEMENT_INCONSISTENT", "Roll number must contain between 1 and 30 characters");
  }
  return normalized;
}

export async function resolveAuthoritativeBatchTuple(
  db: AcademicPlacementDb,
  input: {
    organizationId: string;
    batchId: string;
    assertedBranchId?: string;
    assertedAcademicSession?: string;
    assertedAcademicSessionId?: string;
    requireCourse?: boolean;
  },
) {
  const batch = await db.batch.findFirst({
    where: { organizationId: input.organizationId, id: input.batchId },
    select: {
      id: true,
      organizationId: true,
      branchId: true,
      courseId: true,
      academicSessionId: true,
      capacity: true,
      branch: { select: { id: true, branchName: true, branchCode: true } },
      course: { select: { id: true, title: true, courseCode: true } },
      session: { select: { id: true, name: true, startsAt: true, endsAt: true, isArchived: true } },
    },
  });
  if (!batch) throw new AppError(404, "ACADEMIC_PLACEMENT_INCONSISTENT", "Batch not found");
  if (input.assertedBranchId && input.assertedBranchId !== batch.branchId) {
    throw new AppError(422, "BATCH_BRANCH_MISMATCH", "Student branch must match the selected batch");
  }
  if (input.assertedAcademicSessionId && input.assertedAcademicSessionId !== batch.academicSessionId) {
    throw new AppError(422, "BATCH_SESSION_MISMATCH", "Student session must match the selected batch");
  }
  if (input.assertedAcademicSession && input.assertedAcademicSession.trim().toLocaleUpperCase() !== batch.session.name.toLocaleUpperCase()) {
    throw new AppError(422, "BATCH_SESSION_MISMATCH", "Student session must match the selected batch");
  }
  if (batch.session.isArchived) {
    throw new AppError(409, "ACADEMIC_PLACEMENT_INCONSISTENT", "Archived academic sessions cannot receive new placements");
  }
  if (input.requireCourse && (!batch.courseId || !batch.course)) {
    throw new AppError(422, "BATCH_COURSE_REQUIRED", "The selected batch must have a course before students can be placed in it");
  }
  return batch;
}

export function getActiveAcademicEnrollment(db: AcademicPlacementDb, organizationId: string, studentId: string) {
  return db.studentAcademicEnrollment.findFirst({
    where: { organizationId, studentId, status: StudentAcademicEnrollmentStatus.ACTIVE },
    include: academicEnrollmentInclude,
  });
}

export function resolveHistoricalAcademicEnrollment(
  db: AcademicPlacementDb,
  organizationId: string,
  studentId: string,
  at: Date,
) {
  return db.studentAcademicEnrollment.findFirst({
    where: {
      organizationId,
      studentId,
      status: { not: StudentAcademicEnrollmentStatus.CANCELLED },
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    },
    include: academicEnrollmentInclude,
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
  });
}

export function createActiveAcademicEnrollment(
  db: AcademicPlacementDb,
  input: {
    organizationId: string;
    studentId: string;
    academicSessionId: string;
    branchId: string;
    courseId: string;
    batchId: string;
    rollNo: string;
    source: StudentAcademicEnrollmentSource;
    effectiveFrom: Date;
    createdById: string;
  },
) {
  if (input.source === "BACKFILL") {
    throw new AppError(422, "ACADEMIC_PLACEMENT_INCONSISTENT", "BACKFILL cannot be used for a new academic placement");
  }
  return db.studentAcademicEnrollment.create({
    data: {
      ...input,
      rollNo: normalizeAcademicRollNumber(input.rollNo),
      status: StudentAcademicEnrollmentStatus.ACTIVE,
      effectiveTo: null,
    },
    include: academicEnrollmentInclude,
  });
}

export async function closeActiveAcademicEnrollment(
  db: AcademicPlacementDb,
  enrollment: { id: string; organizationId: string; effectiveFrom: Date },
  effectiveTo: Date,
) {
  const start = enrollment.effectiveFrom.toISOString().slice(0, 10);
  const end = effectiveTo.toISOString().slice(0, 10);
  if (end < start) {
    throw new AppError(422, "ACADEMIC_PLACEMENT_INCONSISTENT", "Placement change date cannot precede the current placement");
  }
  return db.studentAcademicEnrollment.update({
    where: { organizationId_id: { organizationId: enrollment.organizationId, id: enrollment.id } },
    // Effective bounds are civil dates. A legitimate same-day movement is
    // CLOSED; consumers needing intra-day order must use placement context or timestamps.
    data: { status: StudentAcademicEnrollmentStatus.CLOSED, effectiveTo },
  });
}

export function cancelAcademicEnrollment(
  db: AcademicPlacementDb,
  enrollment: { id: string; organizationId: string; effectiveFrom: Date },
) {
  return db.studentAcademicEnrollment.update({
    where: { organizationId_id: { organizationId: enrollment.organizationId, id: enrollment.id } },
    data: { status: StudentAcademicEnrollmentStatus.CANCELLED, effectiveTo: enrollment.effectiveFrom },
  });
}

export function changeActiveEnrollmentRollNo(
  db: AcademicPlacementDb,
  enrollment: { id: string; organizationId: string },
  rollNo: string,
) {
  return db.studentAcademicEnrollment.update({
    where: { organizationId_id: { organizationId: enrollment.organizationId, id: enrollment.id } },
    data: { rollNo: normalizeAcademicRollNumber(rollNo) },
    include: academicEnrollmentInclude,
  });
}

export function synchronizeStudentAcademicProjection(
  db: AcademicPlacementDb,
  input: {
    organizationId: string;
    studentId: string;
    branchId: string;
    batchId: string;
    academicSessionId: string;
    academicSession: string;
    courseTitle: string;
    rollNo: string;
  },
) {
  return db.studentProfile.update({
    where: { organizationId_id: { organizationId: input.organizationId, id: input.studentId } },
    data: {
      branchId: input.branchId,
      batchId: input.batchId,
      academicSessionId: input.academicSessionId,
      academicSession: input.academicSession,
      className: input.courseTitle,
      rollNo: normalizeAcademicRollNumber(input.rollNo),
    },
  });
}

export function assertAcademicProjectionConsistent(
  profile: { branchId: string; batchId: string; academicSessionId: string; rollNo: string },
  enrollment: { branchId: string; batchId: string; academicSessionId: string; rollNo: string },
) {
  if (
    profile.branchId !== enrollment.branchId
    || profile.batchId !== enrollment.batchId
    || profile.academicSessionId !== enrollment.academicSessionId
    || normalizeAcademicRollNumber(profile.rollNo) !== normalizeAcademicRollNumber(enrollment.rollNo)
  ) {
    throw new AppError(409, "ACADEMIC_PLACEMENT_INCONSISTENT", "Student academic projection does not match the active enrollment");
  }
}

export function assertStudentAcademicEligibility(
  enrollment: { branchId: string; batchId: string; academicSessionId: string } | null,
  expected: { branchId?: string; batchId?: string; academicSessionId?: string },
) {
  if (!enrollment) throw new AppError(409, "NO_ACTIVE_ACADEMIC_ENROLLMENT", "Student has no active academic enrollment");
  if (
    (expected.branchId && enrollment.branchId !== expected.branchId)
    || (expected.batchId && enrollment.batchId !== expected.batchId)
    || (expected.academicSessionId && enrollment.academicSessionId !== expected.academicSessionId)
  ) {
    throw new AppError(422, "ACADEMIC_PLACEMENT_INCONSISTENT", "Student is not eligible for this academic placement");
  }
}

export function academicPlacementConflict(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return null;
  const target = Array.isArray(error.meta?.target) ? error.meta.target.map(String) : [String(error.meta?.target ?? "")];
  if (target.includes("studentId")) {
    return new AppError(409, "ACADEMIC_ENROLLMENT_EXISTS", "Student already has an active academic enrollment");
  }
  if (!target.some(field => field === "batchId" || field === "rollNo" || field.includes("btrim(rollNo)"))) return null;
  return new AppError(409, "ACADEMIC_ENROLLMENT_CONFLICT", "The academic placement conflicts with another active enrollment");
}
