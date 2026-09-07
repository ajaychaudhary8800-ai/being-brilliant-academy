import { Role, TeacherAllocationStatus, TimetableStatus } from "@prisma/client";
import { AppError } from "./http.js";
import { prisma } from "./prisma.js";
import type { AuthRequest } from "../middleware/auth.js";

export type CommunicationScope = {
  role: Role;
  branchIds: string[] | null;
  batchIds: string[] | null;
};

export async function assignedBranchIds(userId: string) {
  return (await prisma.branchUser.findMany({ where: { userId }, select: { branchId: true } })).map(item => item.branchId);
}

export async function activeTeacherBatchIds(teacherId: string) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const [timetables, allocations] = await Promise.all([
    prisma.timetable.findMany({ where: { teacherId, status: TimetableStatus.ACTIVE }, select: { batchId: true } }),
    prisma.teacherAllocation.findMany({
      where: { teacherId, status: TeacherAllocationStatus.ACTIVE, effectiveFrom: { lte: today }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] },
      select: { batchId: true },
    }),
  ]);
  return [...new Set([...timetables, ...allocations].map(item => item.batchId))];
}

export async function communicationScope(req: AuthRequest): Promise<CommunicationScope> {
  const role = req.auth!.role;
  if (role === Role.SUPER_ADMIN) return { role, branchIds: null, batchIds: null };
  if (role === Role.BRANCH_ADMIN) return { role, branchIds: await assignedBranchIds(req.auth!.userId), batchIds: null };
  if (role === Role.STUDENT) {
    const profile = await prisma.studentProfile.findUnique({ where: { userId: req.auth!.userId }, select: { branchId: true, batchId: true, status: true } });
    return { role, branchIds: profile?.status === "ACTIVE" ? [profile.branchId] : [], batchIds: profile?.status === "ACTIVE" ? [profile.batchId] : [] };
  }
  if (role === Role.TEACHER) {
    const profile = await prisma.teacherProfile.findUnique({ where: { userId: req.auth!.userId }, select: { id: true, branchId: true } });
    return { role, branchIds: profile ? [profile.branchId] : [], batchIds: profile ? await activeTeacherBatchIds(profile.id) : [] };
  }
  if (role === Role.PARENT) {
    const links = await prisma.parentStudent.findMany({
      where: { parentId: req.auth!.userId, student: { status: "ACTIVE", user: { isActive: true } } },
      select: { student: { select: { branchId: true, batchId: true } } },
    });
    return {
      role,
      branchIds: [...new Set(links.map(link => link.student.branchId))],
      batchIds: [...new Set(links.map(link => link.student.batchId))],
    };
  }
  return { role, branchIds: [], batchIds: [] };
}

const audience = (scope: CommunicationScope) => ({ OR: [{ audience: null }, { audience: scope.role }] });
const branches = (scope: CommunicationScope) => scope.branchIds ? [{ OR: [{ branchId: null }, { branchId: { in: scope.branchIds } }] }] : [];
const batches = (scope: CommunicationScope) => scope.batchIds ? [{ OR: [{ batchId: null }, { batchId: { in: scope.batchIds } }] }] : [];

export function announcementRecipientConstraints(scope: CommunicationScope, now = new Date()) {
  return {
    AND: [
      audience(scope),
      ...branches(scope),
      ...batches(scope),
      { publishedAt: { lte: now } },
      { OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }] },
      { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
    ],
  };
}

export function circularRecipientConstraints(scope: CommunicationScope, now = new Date()) {
  return {
    AND: [
      audience(scope),
      ...branches(scope),
      { OR: [{ publishedAt: null }, { publishedAt: { lte: now } }] },
      { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
    ],
  };
}

export function eventRecipientConstraints(scope: CommunicationScope) {
  return { AND: [audience(scope), ...branches(scope), ...batches(scope), { status: { not: "CANCELLED" } }] };
}

export function branchManagementConstraints(scope: CommunicationScope) {
  return scope.role === Role.BRANCH_ADMIN && scope.branchIds
    ? { OR: [{ branchId: null }, { branchId: { in: scope.branchIds } }] }
    : {};
}

export async function validateCommunicationTarget(
  req: AuthRequest,
  target: { branchId?: string | null; batchId?: string | null },
  options: { teacherMayTarget?: boolean } = {},
) {
  const scope = await communicationScope(req);
  if (req.auth!.role === Role.BRANCH_ADMIN && (!target.branchId || !scope.branchIds?.includes(target.branchId))) {
    throw new AppError(403, "BRANCH_FORBIDDEN", "Branch access denied");
  }
  if (req.auth!.role === Role.TEACHER) {
    if (!options.teacherMayTarget || !target.branchId || !scope.branchIds?.includes(target.branchId)) {
      throw new AppError(403, "BRANCH_FORBIDDEN", "Teachers may target only their own branch");
    }
    if (target.batchId && !scope.batchIds?.includes(target.batchId)) throw new AppError(403, "BATCH_FORBIDDEN", "Teachers may target only assigned batches");
  }
  if (target.batchId) {
    const batch = await prisma.batch.findUnique({ where: { id: target.batchId }, select: { branchId: true } });
    if (!batch || !target.branchId || batch.branchId !== target.branchId) throw new AppError(422, "INVALID_TARGET_BATCH", "Batch must belong to the selected branch");
  }
  return scope;
}

export function assertTeacherOwnedResource(req: AuthRequest, resource: { authorId: string; branchId: string | null }) {
  if (req.auth!.role === Role.TEACHER && (resource.authorId !== req.auth!.userId || !resource.branchId)) {
    throw new AppError(404, "NOT_FOUND", "Communication record not found");
  }
}
