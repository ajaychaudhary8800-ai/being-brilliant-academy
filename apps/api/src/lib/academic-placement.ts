import {
  Prisma,
  PrismaClient,
  StudentAcademicEnrollmentSource,
  StudentAcademicEnrollmentStatus,
  StudentStatus,
} from "@prisma/client";
import { AppError } from "./http.js";

export type AcademicPlacementDb = Prisma.TransactionClient | PrismaClient;

export async function runSerializableAcademicPlacement<Authorization, Result>(
  client: PrismaClient,
  authorize: (tx: Prisma.TransactionClient) => Promise<Authorization>,
  work: (tx: Prisma.TransactionClient, authorization: Authorization, attempt: number) => Promise<Result>,
  maxAttempts = 3,
  conflictCode = "ACADEMIC_ENROLLMENT_CONFLICT",
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await client.$transaction(async tx => work(tx, await authorize(tx), attempt), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const retryable = Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2034");
      if (!retryable) throw error;
      if (attempt === maxAttempts) {
        throw new AppError(409, conflictCode, "The academic placement changed; reload and try again");
      }
    }
  }
  throw new AppError(409, conflictCode, "The academic placement changed; reload and try again");
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

/** Normalize a persisted academic event to the civil DATE used by placement history. */
export function historicalCivilDate(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

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

export async function resolveStudentHistoricalEnrollment(
  db: AcademicPlacementDb,
  input: Omit<HistoricalAcademicEnrollmentInput, "studentId"> & { userId: string },
) {
  const profile = await db.studentProfile.findFirst({
    where: { organizationId: input.organizationId, userId: input.userId },
    select: { id: true },
  });
  if (!profile) return null;
  return resolveHistoricalAcademicEnrollment(db, { ...input, studentId: profile.id });
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

export type StudentAcademicTransitionInput = {
  organizationId: string;
  studentId: string;
  type: "PROMOTED" | "RETAINED" | "TRANSFERRED" | "LEFT" | "GRADUATED";
  effectiveDate: Date;
  targetBatchId?: string;
  rollNo?: string;
  reason?: string | null;
  createdById: string;
  authorizedBranchIds?: string[] | null;
  authorizeBranchIds?: (tx: Prisma.TransactionClient) => Promise<string[] | null>;
};

/** Atomically consume the student's authoritative ACTIVE placement and record its transition. */
export async function transitionStudentAcademicPlacement(client: PrismaClient, input: StudentAcademicTransitionInput) {
  let expectedSourceEnrollmentId: string | null = null;
  return runSerializableAcademicPlacement(client, input.authorizeBranchIds ?? (async () => input.authorizedBranchIds ?? null), async (tx, branchIds) => {
    const profile = await tx.studentProfile.findFirst({
      where: { organizationId: input.organizationId, id: input.studentId },
      select: { id: true, status: true, branchId: true, batchId: true, academicSessionId: true, rollNo: true },
    });
    if (!profile) throw new AppError(404, "STUDENT_NOT_FOUND", "Student not found");
    let source;
    if (expectedSourceEnrollmentId) {
      source = await tx.studentAcademicEnrollment.findFirst({ where: { organizationId: input.organizationId, studentId: input.studentId, id: expectedSourceEnrollmentId, status: StudentAcademicEnrollmentStatus.ACTIVE }, include: academicEnrollmentInclude });
      if (!source) throw new AppError(409, "ACADEMIC_TRANSITION_CONFLICT", "The student's academic placement changed; reload and retry");
    } else {
      const activeRows = await tx.studentAcademicEnrollment.findMany({
        where: { organizationId: input.organizationId, studentId: input.studentId, status: StudentAcademicEnrollmentStatus.ACTIVE },
        include: academicEnrollmentInclude,
      });
      if (activeRows.length === 0) throw new AppError(409, "NO_ACTIVE_ACADEMIC_ENROLLMENT", "Student has no active academic enrollment");
      if (activeRows.length !== 1) throw new AppError(409, "ACADEMIC_ENROLLMENT_INTEGRITY_ERROR", "Student has multiple active academic enrollments");
      source = activeRows[0];
      expectedSourceEnrollmentId = source.id;
    }
    if (input.effectiveDate.getTime() < source.effectiveFrom.getTime()) throw new AppError(422, "INVALID_TRANSITION_DATE", "Transition date cannot precede the source enrollment");
    if (branchIds && !branchIds.includes(source.branchId)) throw new AppError(403, "ACADEMIC_TRANSITION_FORBIDDEN", "Source branch access denied");

    const hasDestination = input.type === "PROMOTED" || input.type === "RETAINED" || input.type === "TRANSFERRED";
    if (hasDestination && !input.targetBatchId) throw new AppError(422, "INVALID_TRANSITION_TARGET", "A destination Batch is required for this transition");
    if (!hasDestination && input.targetBatchId) throw new AppError(422, "INVALID_TRANSITION_TARGET", "This transition cannot have a destination Batch");

    let target: Awaited<ReturnType<typeof resolveAuthoritativeBatchTuple>> | null = null;
    if (input.targetBatchId) {
      try {
        target = await resolveAuthoritativeBatchTuple(tx, { organizationId: input.organizationId, batchId: input.targetBatchId, requireCourse: true });
      } catch (error) {
        if (error instanceof AppError && ["ACADEMIC_PLACEMENT_INCONSISTENT", "BATCH_COURSE_REQUIRED"].includes(error.code)) throw new AppError(422, "INVALID_TRANSITION_TARGET", "Destination Batch is invalid");
        throw error;
      }
      const [batch, branch] = await Promise.all([
        tx.batch.findFirst({ where: { organizationId: input.organizationId, id: target.id, status: "ACTIVE" }, select: { id: true } }),
        tx.branch.findFirst({ where: { organizationId: input.organizationId, id: target.branchId, isActive: true }, select: { id: true } }),
      ]);
      if (!batch || !branch) throw new AppError(422, "INVALID_TRANSITION_TARGET", "Destination Batch must belong to an active branch and session");
      if (branchIds && !branchIds.includes(target.branchId)) throw new AppError(403, "ACADEMIC_TRANSITION_FORBIDDEN", "Destination branch access denied");
      if (input.type === "RETAINED" && (!source.courseId || source.courseId !== target.course!.id)) throw new AppError(422, "INVALID_TRANSITION_TARGET", "A retained student must remain in the same Course");
      if (target.id === source.batchId && target.academicSessionId === source.academicSessionId && target.branchId === source.branchId) throw new AppError(422, "INVALID_TRANSITION_TARGET", "Destination must be a new academic placement");
      const occupied = await tx.studentAcademicEnrollment.count({ where: { organizationId: input.organizationId, batchId: target.id, status: StudentAcademicEnrollmentStatus.ACTIVE, studentId: { not: input.studentId } } });
      if (occupied >= target.capacity) throw new AppError(409, "BATCH_CAPACITY_REACHED", "The destination Batch is at full capacity");
    }
    if (target && !input.rollNo) throw new AppError(422, "INVALID_TRANSITION_TARGET", "A destination roll number is required");
    const rollNo = target ? normalizeAcademicRollNumber(input.rollNo!) : null;
    const closed = await tx.studentAcademicEnrollment.updateMany({ where: { organizationId: input.organizationId, id: source.id, status: StudentAcademicEnrollmentStatus.ACTIVE }, data: { status: StudentAcademicEnrollmentStatus.CLOSED, effectiveTo: input.effectiveDate } });
    if (closed.count !== 1) throw new AppError(409, "ACADEMIC_TRANSITION_CONFLICT", "The student's academic placement changed; reload and retry");
    const destination = target ? await createActiveAcademicEnrollment(tx, { organizationId: input.organizationId, studentId: input.studentId, branchId: target.branchId, batchId: target.id, courseId: target.course!.id, academicSessionId: target.academicSessionId, rollNo: rollNo!, source: input.type === "PROMOTED" ? StudentAcademicEnrollmentSource.PROMOTION : input.type === "RETAINED" ? StudentAcademicEnrollmentSource.RETENTION : StudentAcademicEnrollmentSource.TRANSFER, effectiveFrom: input.effectiveDate, createdById: input.createdById }) : null;
    if (destination) await tx.studentProfile.update({ where: { organizationId_id: { organizationId: input.organizationId, id: input.studentId } }, data: { branchId: destination.branchId, batchId: destination.batchId, academicSessionId: destination.academicSessionId, academicSession: target!.session.name, className: target!.course!.title, rollNo: destination.rollNo, status: StudentStatus.ACTIVE } });
    else await tx.studentProfile.update({ where: { organizationId_id: { organizationId: input.organizationId, id: input.studentId } }, data: { status: StudentStatus.INACTIVE } });
    const transition = await tx.studentAcademicTransition.create({ data: { organizationId: input.organizationId, studentId: input.studentId, type: input.type, fromEnrollmentId: source.id, toEnrollmentId: destination?.id ?? null, effectiveDate: input.effectiveDate, reason: input.reason ?? null, createdById: input.createdById } });
    await tx.auditLog.create({ data: { organizationId: input.organizationId, actorId: input.createdById, action: `STUDENT_ACADEMIC_${input.type}`, entity: "StudentAcademicTransition", entityId: transition.id, metadata: { studentId: input.studentId, fromEnrollmentId: source.id, toEnrollmentId: destination?.id ?? null } } });
    return { transition, source, destination };
  }, 3, "ACADEMIC_TRANSITION_CONFLICT");
}
