import { CertificateStatus, StudentStatus, TeacherAllocationStatus, type Prisma } from "@prisma/client";
import { AppError } from "./http.js";

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

export function selectEligibleParentHomeworkChild<T extends { student: { batchId: string }; enrollment: unknown | null }>(
  candidates: readonly T[],
  homeworkBatchId: string,
) {
  return candidates.find(candidate => candidate.student.batchId === homeworkBatchId || Boolean(candidate.enrollment)) ?? null;
}

export function assertActiveStudentPortalProfile(status: StudentStatus) {
  if (status !== StudentStatus.ACTIVE) {
    throw new AppError(403, "STUDENT_PROFILE_INACTIVE", "An active Student profile is required");
  }
}

export function portalCertificateVisible(status: CertificateStatus) {
  return status === CertificateStatus.ISSUED || status === CertificateStatus.ARCHIVED;
}

export function assertPortalCertificateDownloadable(status: CertificateStatus) {
  if (!portalCertificateVisible(status)) {
    throw new AppError(404, "CERTIFICATE_NOT_AVAILABLE", "Certificate is not available");
  }
}
