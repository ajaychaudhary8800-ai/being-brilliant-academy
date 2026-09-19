import { TeacherAllocationStatus, type Prisma } from "@prisma/client";

export type CertificateTeacherAccessContext = {
  branchId: string;
  courseId: string | null;
  batchId: string | null;
  effectiveAt: Date;
};

export function teacherOwnsExamination(teacherId: string, examinationTeacherId: string) {
  return teacherId === examinationTeacherId;
}

export function certificateTeacherAllocationWhere(
  teacherId: string,
  context: CertificateTeacherAccessContext,
): Prisma.TeacherAllocationWhereInput | null {
  if (!context.courseId || !context.batchId) return null;
  return {
    teacherId,
    branchId: context.branchId,
    courseId: context.courseId,
    batchId: context.batchId,
    status: TeacherAllocationStatus.ACTIVE,
    effectiveFrom: { lte: context.effectiveAt },
    OR: [{ effectiveTo: null }, { effectiveTo: { gte: context.effectiveAt } }],
  };
}
