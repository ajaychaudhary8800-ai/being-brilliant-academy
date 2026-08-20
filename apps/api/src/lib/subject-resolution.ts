import { TeacherAllocationStatus } from "@prisma/client";
import { AppError } from "./http.js";
import { prisma } from "./prisma.js";

export type SubjectContext = { branchId: string; courseId: string; batchId: string; teacherId: string; academicSessionId: string; subjectId?: string; effectiveAt?: Date; rangeStart?: Date; rangeEnd?: Date };

export function effectiveDateForSession(startsAt: Date, endsAt: Date, now = new Date()) {
  if (now < startsAt) return startsAt;
  if (now > endsAt) return endsAt;
  return now;
}

export function allocationWhere(context: SubjectContext) {
  const effectiveAt = context.effectiveAt ?? (!context.rangeStart || !context.rangeEnd ? new Date() : undefined);
  return {
    branchId: context.branchId,
    courseId: context.courseId,
    batchId: context.batchId,
    teacherId: context.teacherId,
    academicSessionId: context.academicSessionId,
    ...(context.subjectId ? { subjectId: context.subjectId } : {}),
    status: TeacherAllocationStatus.ACTIVE,
    ...(effectiveAt
      ? { effectiveFrom: { lte: effectiveAt }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveAt } }] }
      : { effectiveFrom: { lte: context.rangeEnd! }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: context.rangeStart! } }] }),
  };
}

export async function allocatedSubjects(context: SubjectContext) {
  const rows = await prisma.teacherAllocation.findMany({ where: allocationWhere(context), select: { subject: { select: { id: true, name: true, code: true } }, weeklyPeriods: true, effectiveFrom: true, effectiveTo: true }, orderBy: { subjectName: "asc" } });
  const active = new Set((await prisma.courseSubject.findMany({ where: { courseId: context.courseId, isActive: true, subjectId: { in: rows.map(row => row.subject.id) } }, select: { subjectId: true } })).map(row => row.subjectId));
  return rows.filter(row => active.has(row.subject.id)).map(row => ({ ...row.subject, weeklyPeriods: row.weeklyPeriods, effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo }));
}

export async function requireAllocatedSubject(context: SubjectContext) {
  const [allocation, link] = await Promise.all([
    prisma.teacherAllocation.findFirst({ where: allocationWhere(context), select: { id: true } }),
    context.subjectId ? prisma.courseSubject.findUnique({ where: { courseId_subjectId: { courseId: context.courseId, subjectId: context.subjectId } }, select: { isActive: true } }) : Promise.resolve(null),
  ]);
  if (!allocation || context.subjectId && !link?.isActive) throw new AppError(422, "TEACHER_SUBJECT_NOT_ALLOCATED", "The selected subject is not effectively allocated and active for this teacher, course, batch and academic session");
  return allocation;
}
