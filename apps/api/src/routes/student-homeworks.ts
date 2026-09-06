import { HomeworkStatus, Prisma, Role, StudentStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import {
  assertHomeworkSubmissionContent,
  assertHomeworkSubmissionReplaceable,
  assertHomeworkSubmissionReplaced,
  assertStudentHomeworkIdentityNotSupplied,
  assertStudentHomeworkSubmissionAccess,
  homeworkSubmissionStatusAt,
  replaceableHomeworkSubmissionStatuses,
} from "../lib/homework-policy.js";
import { AppError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import {
  allowedDocumentTypes,
  assertDocumentFileExtension,
  decodeVerifiedUpload,
  type AllowedDocumentType,
} from "../lib/secure-upload.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, allow(Role.STUDENT));

const attachment = z.object({
  name: z.string().trim().min(1).max(180),
  mimeType: z.enum(allowedDocumentTypes),
  base64: z.string().min(1),
}).nullable().optional();
const submissionInput = z.object({
  answerText: z.string().trim().max(10000).nullable().optional(),
  attachment,
}).strict();
const submissionSelect = {
  id: true,
  submittedAt: true,
  status: true,
  attachmentName: true,
  attachmentSize: true,
  answerText: true,
  student: { select: { id: true, admissionNo: true, user: { select: { name: true } } } },
} as const;
const serializable = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;

function submissionFile(value: z.infer<typeof attachment>, clear = false) {
  if (value === undefined) return {};
  if (value === null) {
    return clear
      ? { attachmentName: null, attachmentMime: null, attachmentSize: null, attachmentData: null }
      : {};
  }
  assertDocumentFileExtension(value.name, value.mimeType as AllowedDocumentType);
  const data = decodeVerifiedUpload(value.base64, value.mimeType as AllowedDocumentType, 5 * 1024 * 1024);
  return { attachmentName: value.name, attachmentMime: value.mimeType, attachmentSize: data.length, attachmentData: data };
}

router.post("/homeworks/:id/submissions", async (req: AuthRequest, res) => {
  assertStudentHomeworkIdentityNotSupplied((req.body as Record<string, unknown> | undefined)?.studentId);
  const input = submissionInput.parse(req.body);
  const student = await prisma.studentProfile.findFirst({
    where: { userId: req.auth!.userId, organizationId: req.auth!.organizationId },
    select: {
      id: true,
      organizationId: true,
      batchId: true,
      status: true,
      user: { select: { isActive: true } },
      batch: { select: { courseId: true } },
    },
  });
  if (!student) throw new AppError(403, "STUDENT_NOT_ELIGIBLE", "An active Student profile is required");

  const homework = await prisma.homework.findFirst({
    where: { id: String(req.params.id), organizationId: req.auth!.organizationId },
    select: { id: true, organizationId: true, batchId: true, courseId: true, dueDate: true, status: true },
  });
  if (!homework) throw new AppError(404, "HOMEWORK_NOT_FOUND", "Homework not found");
  assertStudentHomeworkSubmissionAccess({
    role: req.auth!.role,
    requestOrganizationId: req.auth!.organizationId,
    homeworkOrganizationId: homework.organizationId,
    homeworkStatus: homework.status,
    homeworkBatchId: homework.batchId,
    homeworkCourseId: homework.courseId,
    userIsActive: student.user.isActive,
    studentOrganizationId: student.organizationId,
    studentBatchId: student.batchId,
    studentCourseId: student.batch.courseId,
    studentStatus: student.status,
  });
  assertHomeworkSubmissionContent(input.answerText, Boolean(input.attachment));

  const submittedAt = new Date();
  const status = homeworkSubmissionStatusAt(homework.dueDate, submittedAt);
  const { attachment: submittedAttachment, ...answer } = input;
  const submittedFile = submissionFile(submittedAttachment, true);

  try {
    const data = await prisma.$transaction(async tx => {
      const currentHomework = await tx.homework.findFirst({
        where: { id: homework.id, organizationId: req.auth!.organizationId },
        select: { status: true },
      });
      if (!currentHomework || currentHomework.status !== HomeworkStatus.PUBLISHED) {
        throw new AppError(409, "HOMEWORK_NOT_OPEN", "Homework is not open for submission");
      }

      const where = {
        organizationId: req.auth!.organizationId,
        homeworkId: homework.id,
        studentId: student.id,
      };
      const existing = await tx.homeworkSubmission.findFirst({
        where,
        select: { id: true, status: true, updatedAt: true },
      });
      let saved;
      if (existing) {
        assertHomeworkSubmissionReplaceable(existing.status);
        const changed = await tx.homeworkSubmission.updateMany({
          where: {
            ...where,
            id: existing.id,
            updatedAt: existing.updatedAt,
            status: { in: replaceableHomeworkSubmissionStatuses },
          },
          data: {
            ...answer,
            ...submittedFile,
            submittedAt,
            status,
            marksObtained: null,
            feedback: null,
            evaluatedAt: null,
          },
        });
        assertHomeworkSubmissionReplaced(changed.count);
        saved = await tx.homeworkSubmission.findFirstOrThrow({
          where: { ...where, id: existing.id },
          select: submissionSelect,
        });
      } else {
        saved = await tx.homeworkSubmission.create({
          data: {
            organizationId: req.auth!.organizationId,
            homeworkId: homework.id,
            studentId: student.id,
            ...answer,
            ...submittedFile,
            submittedAt,
            status,
          },
          select: submissionSelect,
        });
      }
      await tx.auditLog.create({
        data: {
          organizationId: req.auth!.organizationId,
          actorId: req.auth!.userId,
          action: existing ? "REPLACE" : "CREATE",
          entity: "HomeworkSubmission",
          entityId: saved.id,
          metadata: { homeworkId: homework.id, studentProfileId: student.id },
        },
      });
      return saved;
    }, serializable);
    res.status(201).json({ data });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "P2002" || code === "P2034") {
      throw new AppError(409, "SUBMISSION_CHANGED", "The Homework submission changed; reload and try again");
    }
    throw error;
  }
});

export default router;
