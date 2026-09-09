import { Role, TeacherAllocationStatus } from "@prisma/client";
import type { AuthRequest } from "../middleware/auth.js";
import { AppError } from "./http.js";
import { prisma } from "./prisma.js";
import { requireAllocatedSubject } from "./subject-resolution.js";
import {
  assertLmsContentAccess,
  assertLmsManagementAccess,
  type LmsActor,
  type LmsTarget,
} from "./lms-policy.js";

export type TeacherLmsAllocation = {
  branchId: string;
  courseId: string;
  batchId: string;
  subjectId: string;
};

type TeacherScopedLmsTarget = {
  branchId: string | null;
  courseId?: string | null;
  batchId?: string | null;
  subjectId?: string | null;
  teacherId: string | null;
};

export async function lmsActorForRequest(req: AuthRequest): Promise<LmsActor> {
  const role = req.auth!.role;
  if (role === Role.BRANCH_ADMIN) {
    const branches = await prisma.branchUser.findMany({ where: { userId: req.auth!.userId }, select: { branchId: true } });
    return { role, branchIds: branches.map(item => item.branchId) };
  }
  if (role === Role.TEACHER) {
    const profile = await prisma.teacherProfile.findUnique({ where: { userId: req.auth!.userId }, select: { id: true, branchId: true } });
    return { role, branchIds: profile ? [profile.branchId] : [], teacherProfileId: profile?.id };
  }
  if (role === Role.STUDENT) {
    const profile = await prisma.studentProfile.findUnique({ where: { userId: req.auth!.userId }, select: { batchId: true, status: true } });
    return { role, branchIds: [], studentBatchId: profile?.batchId, studentActive: profile?.status === "ACTIVE" };
  }
  return { role, branchIds: [] };
}

async function requireCurrentTeacherTargetAllocation(actor: LmsActor, target: TeacherScopedLmsTarget) {
  if (actor.role !== Role.TEACHER) return;
  if (!target.branchId || !target.courseId || !target.batchId || !target.subjectId || !target.teacherId) {
    throw new AppError(403, "LMS_FORBIDDEN", "Learning content is not available to this account");
  }
  const batch = await prisma.batch.findUnique({ where: { id: target.batchId }, select: { branchId: true, courseId: true, academicSessionId: true } });
  if (!batch || batch.branchId !== target.branchId || batch.courseId !== target.courseId) {
    throw new AppError(403, "LMS_FORBIDDEN", "Learning content is not available to this account");
  }
  try {
    await requireTeacherLmsAllocation(actor, { ...target, branchId: target.branchId, courseId: target.courseId, batchId: target.batchId, subjectId: target.subjectId, teacherId: target.teacherId, academicSessionId: batch.academicSessionId });
  } catch (error) {
    if (error instanceof AppError && error.code === "TEACHER_SUBJECT_NOT_ALLOCATED") {
      throw new AppError(403, "LMS_FORBIDDEN", "Learning content is not available to this account");
    }
    throw error;
  }
}

export async function assertLmsRequestContentAccess(req: AuthRequest, target: LmsTarget & TeacherScopedLmsTarget) {
  const actor = await lmsActorForRequest(req);
  assertLmsContentAccess(actor, target);
  await requireCurrentTeacherTargetAllocation(actor, target);
}

export async function assertLmsRequestManagementAccess(req: AuthRequest, target: TeacherScopedLmsTarget) {
  const actor = await lmsActorForRequest(req);
  assertLmsManagementAccess(actor, target);
  await requireCurrentTeacherTargetAllocation(actor, target);
}

export async function activeTeacherLmsAllocations(actor: LmsActor, effectiveAt = new Date()): Promise<TeacherLmsAllocation[] | null> {
  if (actor.role !== Role.TEACHER) return null;
  if (!actor.teacherProfileId) return [];
  return prisma.teacherAllocation.findMany({
    where: {
      teacherId: actor.teacherProfileId,
      status: TeacherAllocationStatus.ACTIVE,
      effectiveFrom: { lte: effectiveAt },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveAt } }],
    },
    select: { branchId: true, courseId: true, batchId: true, subjectId: true },
  });
}

export async function requireTeacherLmsAllocation(
  actor: LmsActor,
  target: TeacherLmsAllocation & { teacherId: string; academicSessionId: string },
  effectiveAt = new Date(),
) {
  if (actor.role === Role.TEACHER && (!actor.teacherProfileId || actor.teacherProfileId !== target.teacherId)) {
    assertLmsManagementAccess(actor, { branchId: target.branchId, teacherId: target.teacherId });
  }
  await requireAllocatedSubject({
    branchId: target.branchId,
    courseId: target.courseId,
    batchId: target.batchId,
    teacherId: target.teacherId,
    academicSessionId: target.academicSessionId,
    subjectId: target.subjectId,
    effectiveAt,
  });
}
