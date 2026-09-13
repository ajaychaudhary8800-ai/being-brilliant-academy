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

export type AcademicEnrollmentResolutionMode =
  | "CURRENT_OR_NEW_WRITE"
  | "HISTORICAL_READ"
  | "HISTORICAL_CORRECTION";

export type HistoricalAcademicEnrollmentInput = {
  organizationId: string;
  studentId: string;
  branchId?: string;
  academicSessionId?: string;
  courseId?: string | null;
  batchId?: string;
  onDate?: Date;
  mode: AcademicEnrollmentResolutionMode;
};

/**
 * Resolve the enrollment which proves that a student was associated with a
 * record's stored academic context.  The context is matched before temporal
 * semantics so a same-day CLOSED civil-date placement can only be accepted
 * when the persisted Batch/Session/Branch tuple identifies it uniquely.
 */
export function resolveHistoricalAcademicEnrollment(
  db: AcademicPlacementDb,
  input: HistoricalAcademicEnrollmentInput,
): Promise<any>;
export function resolveHistoricalAcademicEnrollment(
  db: AcademicPlacementDb,
  organizationId: string,
  studentId: string,
  at: Date,
): Promise<any>;
export async function resolveHistoricalAcademicEnrollment(
  db: AcademicPlacementDb,
  inputOrOrganization: HistoricalAcademicEnrollmentInput | string,
  legacyStudentId?: string,
  legacyAt?: Date,
) {
  const input: HistoricalAcademicEnrollmentInput = typeof inputOrOrganization === "string"
    ? { organizationId: inputOrOrganization, studentId: legacyStudentId!, onDate: legacyAt, mode: "HISTORICAL_READ" }
    : inputOrOrganization;
  const rows = await db.studentAcademicEnrollment.findMany({
    where: {
      organizationId: input.organizationId,
      studentId: input.studentId,
      status: { not: StudentAcademicEnrollmentStatus.CANCELLED },
    },
    include: academicEnrollmentInclude,
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
  });
  const hasExplicitContext = Boolean(input.batchId || input.academicSessionId || input.branchId || input.courseId !== undefined);
  const contextMatches = rows.filter(row => (
    (!input.batchId || row.batchId === input.batchId)
    && (!input.academicSessionId || row.academicSessionId === input.academicSessionId)
    && (!input.branchId || row.branchId === input.branchId)
    && (input.courseId === undefined || row.courseId === input.courseId)
  ));
  // A reconstructed/current enrollment must not invalidate an older stored
  // record for which Batch 1 could not reconstruct history. Only new writes
  // require a positively matching enrollment; historical callers may apply
  // their strict legacy-record policy when resolution returns null.
  if (input.mode === "CURRENT_OR_NEW_WRITE" && hasExplicitContext && contextMatches.length === 0 && rows.length > 0) {
    throw new AppError(422, "ACADEMIC_HISTORY_CONTEXT_MISMATCH", "Student enrollment history does not match the stored academic context");
  }
  if (!hasExplicitContext && input.onDate && rows.some(row => row.status === StudentAcademicEnrollmentStatus.CLOSED && row.effectiveTo?.getTime() === row.effectiveFrom.getTime() && row.effectiveFrom.getTime() === input.onDate!.getTime())) {
    throw new AppError(409, "ACADEMIC_ENROLLMENT_AMBIGUOUS", "A same-day academic placement requires explicit academic context");
  }

  const candidates = contextMatches.filter(row => {
    if (!input.onDate) return true;
    const at = input.onDate;
    const inHalfOpenInterval = row.effectiveFrom <= at && (row.effectiveTo === null || at < row.effectiveTo);
    if (inHalfOpenInterval) return true;
    // Civil DATE data cannot express an intra-day move. A zero-length CLOSED
    // placement is valid evidence only when explicit context disambiguates it.
    return hasExplicitContext
      && input.mode !== "CURRENT_OR_NEW_WRITE"
      && row.status === StudentAcademicEnrollmentStatus.CLOSED
      && row.effectiveFrom.getTime() === row.effectiveTo?.getTime()
      && row.effectiveFrom.getTime() === at.getTime();
  });
  if (candidates.length > 1) {
    throw new AppError(409, "ACADEMIC_ENROLLMENT_AMBIGUOUS", "More than one academic enrollment matches this context");
  }
  const resolved = candidates[0] ?? null;
  if (!resolved && input.mode === "CURRENT_OR_NEW_WRITE") {
    throw new AppError(409, "NO_ACTIVE_ACADEMIC_ENROLLMENT", "Student has no academic enrollment for this context and date");
  }
  return resolved;
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
