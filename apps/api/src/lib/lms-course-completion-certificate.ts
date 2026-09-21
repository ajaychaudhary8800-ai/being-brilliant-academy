import { CertificateStatus, CertificateType, StudentStatus } from "@prisma/client";
import { prisma } from "./prisma.js";

const COMPLETION_THRESHOLD = 80;

type EnsureCourseCompletionCertificateInput = {
  organizationId: string;
  userId: string;
};

export async function ensureCourseCompletionCertificate(input: EnsureCourseCompletionCertificateInput) {
  const student = await prisma.studentProfile.findFirst({
    where: { organizationId: input.organizationId, userId: input.userId, status: StudentStatus.ACTIVE },
    select: {
      id: true,
      branchId: true,
      batchId: true,
      batch: { select: { courseId: true, course: { select: { title: true } } } },
    },
  });
  if (!student?.batchId || !student.batch?.courseId) return null;

  const existing = await prisma.certificate.findFirst({
    where: {
      organizationId: input.organizationId,
      studentId: student.id,
      courseId: student.batch.courseId,
      type: CertificateType.COURSE_COMPLETION,
    },
    select: { id: true, certificateNumber: true, status: true, verificationToken: true, issuedAt: true },
  });
  if (existing) return existing;

  const [total, completed] = await Promise.all([
    prisma.lesson.count({
      where: {
        organizationId: input.organizationId,
        batchId: student.batchId,
        status: "PUBLISHED",
      },
    }),
    prisma.lessonProgress.count({
      where: {
        organizationId: input.organizationId,
        userId: input.userId,
        completed: true,
        lesson: {
          organizationId: input.organizationId,
          batchId: student.batchId,
          status: "PUBLISHED",
        },
      },
    }),
  ]);

  if (!total || Math.round((completed / total) * 100) < COMPLETION_THRESHOLD) return null;

  const now = new Date();
  const suffix = [student.id, student.batch.courseId].map(value => value.slice(-6).toUpperCase()).join("-");
  const certificateNumber = `BBA-COURSE-${now.getUTCFullYear()}-${suffix}`;

  try {
    return await prisma.certificate.create({
      data: {
        organizationId: input.organizationId,
        certificateNumber,
        studentId: student.id,
        branchId: student.branchId,
        courseId: student.batch.courseId,
        batchId: student.batchId,
        type: CertificateType.COURSE_COMPLETION,
        issueDate: now,
        purpose: `Completed ${student.batch.course.title} with at least ${COMPLETION_THRESHOLD}% of published LMS lessons completed.`,
        status: CertificateStatus.ISSUED,
        templateKey: "completion",
        digitalSignature: "System-issued LMS completion certificate",
        issuedAt: now,
      },
      select: { id: true, certificateNumber: true, status: true, verificationToken: true, issuedAt: true },
    });
  } catch (error: any) {
    if (error?.code !== "P2002") throw error;
    return prisma.certificate.findFirst({
      where: {
        organizationId: input.organizationId,
        studentId: student.id,
        courseId: student.batch.courseId,
        type: CertificateType.COURSE_COMPLETION,
      },
      select: { id: true, certificateNumber: true, status: true, verificationToken: true, issuedAt: true },
    });
  }
}

export const LMS_COURSE_COMPLETION_THRESHOLD = COMPLETION_THRESHOLD;
