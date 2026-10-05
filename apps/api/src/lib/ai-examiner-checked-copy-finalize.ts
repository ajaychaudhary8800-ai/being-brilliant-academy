import {
  AIExaminerAnnotationApprovalState,
  AIExaminerAnnotationAuthorType,
  AIExaminerCheckedCopyRevisionStatus,
  AIExaminerEvaluationStatus,
  Prisma,
} from "@prisma/client";
import { AppError } from "./http.js";
import { systemPrisma } from "./prisma.js";
import {
  assertCheckedCopyApprovalReady,
  sha256Buffer,
} from "./ai-examiner-checked-copy-state.js";
import {
  renderAIExaminerCheckedCopy,
  type CheckedCopyPersistedAnnotation,
} from "./ai-examiner-checked-copy.js";

const revisionInclude = {
  annotations: { include: { anchor: true }, orderBy: { sortOrder: "asc" as const } },
  checkedCopy: {
    include: {
      answerSheet: {
        select: {
          id: true,
          fileName: true,
          mimeType: true,
          fileData: true,
          finalizedAt: true,
          marksObtained: true,
          student: { select: { user: { select: { name: true } } } },
          examination: { select: { name: true, maximumMarks: true } },
        },
      },
    },
  },
  evaluation: {
    include: {
      reviewedBy: { select: { name: true } },
      questions: { orderBy: { createdAt: "asc" as const } },
    },
  },
} satisfies Prisma.AIExaminerCheckedCopyRevisionInclude;

function canonicalAnnotations(
  revision: Prisma.AIExaminerCheckedCopyRevisionGetPayload<{ include: typeof revisionInclude }>,
): CheckedCopyPersistedAnnotation[] {
  return revision.annotations.map(annotation => ({
    type: annotation.type,
    content: annotation.content,
    questionKey: annotation.questionKey,
    marks: annotation.marks == null ? null : Number(annotation.marks),
    approvalState: annotation.approvalState,
    vectorData: annotation.vectorData,
    anchor: annotation.anchor ? {
      pageNumber: annotation.anchor.pageNumber,
      x: Number(annotation.anchor.x),
      y: Number(annotation.anchor.y),
      width: Number(annotation.anchor.width),
      height: Number(annotation.anchor.height),
      rotation: Number(annotation.anchor.rotation),
    } : null,
  }));
}

async function revisionForFinalize(organizationId: string, revisionId: string) {
  const revision = await systemPrisma.aIExaminerCheckedCopyRevision.findFirst({
    where: { id: revisionId, organizationId },
    include: revisionInclude,
  });
  if (!revision) throw new AppError(404, "AI_CHECKED_COPY_NOT_FOUND", "Checked-copy revision not found");
  return revision;
}

export async function finalizeAIExaminerCheckedCopyIfReady(input: {
  organizationId: string;
  revisionId: string;
  actorId: string;
}) {
  let revision = await revisionForFinalize(input.organizationId, input.revisionId);

  if (
    revision.status === AIExaminerCheckedCopyRevisionStatus.RENDERED ||
    revision.status === AIExaminerCheckedCopyRevisionStatus.PUBLISHED
  ) {
    return { revision, alreadyRendered: true, placement: null, pageCount: revision.sourcePageCount };
  }
  if (
    revision.status !== AIExaminerCheckedCopyRevisionStatus.DRAFT &&
    revision.status !== AIExaminerCheckedCopyRevisionStatus.APPROVED
  ) {
    throw new AppError(409, "AI_CHECKED_COPY_IMMUTABLE", "This checked-copy revision cannot be approved");
  }

  const sheet = revision.checkedCopy.answerSheet;
  if (
    !sheet.finalizedAt ||
    sheet.marksObtained == null ||
    revision.evaluation.status !== AIExaminerEvaluationStatus.APPROVED
  ) {
    throw new AppError(
      409,
      "AI_CHECKED_COPY_GRADING_INCOMPLETE",
      "Finalized teacher-approved grading is required",
    );
  }

  if (revision.status === AIExaminerCheckedCopyRevisionStatus.DRAFT) {
    try {
      assertCheckedCopyApprovalReady({
        annotations: revision.annotations.map(row => ({
          type: row.type,
          questionKey: row.questionKey,
          content: row.content,
          marks: row.marks,
          approvalState: row.approvalState,
          anchor: row.anchor,
        })),
        questions: revision.evaluation.questions.map(question => ({
          questionKey: question.questionKey,
          finalMarks: Number(question.finalMarks),
        })),
        totalMarks: Number(sheet.marksObtained),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Checked-copy review is incomplete";
      if (message.startsWith("POSITION_REVIEW_REQUIRED:")) {
        throw new AppError(
          409,
          "AI_CHECKED_COPY_POSITION_REVIEW_REQUIRED",
          `${message.split(":")[1]} annotation(s) still require teacher positioning before approval`,
        );
      }
      throw new AppError(409, "AI_CHECKED_COPY_APPROVAL_INTEGRITY", message);
    }

    const approvedAt = new Date();
    await systemPrisma.$transaction(async tx => {
      await tx.aIExaminerAnnotation.updateMany({
        where: {
          organizationId: input.organizationId,
          revisionId: revision.id,
          approvalState: AIExaminerAnnotationApprovalState.AI_DRAFT,
        },
        data: {
          approvalState: AIExaminerAnnotationApprovalState.APPROVED,
          authorType: AIExaminerAnnotationAuthorType.TEACHER,
          authorId: input.actorId,
        },
      });
      const locked = await tx.aIExaminerCheckedCopyRevision.updateMany({
        where: {
          id: revision.id,
          organizationId: input.organizationId,
          status: AIExaminerCheckedCopyRevisionStatus.DRAFT,
        },
        data: {
          status: AIExaminerCheckedCopyRevisionStatus.APPROVED,
          approvedById: input.actorId,
          approvedAt,
        },
      });
      if (locked.count !== 1) {
        throw new AppError(
          409,
          "AI_CHECKED_COPY_REVIEW_CHANGED",
          "Checked-copy review changed; refresh and retry",
        );
      }
      await tx.auditLog.create({
        data: {
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: "AI_CHECKED_COPY_APPROVED",
          entity: "AIExaminerCheckedCopyRevision",
          entityId: revision.id,
          metadata: { revision: revision.revision, evaluationId: revision.evaluationId, source: "FINALIZE_SERVICE" },
        },
      });
    });
    revision = await revisionForFinalize(input.organizationId, revision.id);
  }

  const refreshedSheet = revision.checkedCopy.answerSheet;
  const source = {
    fileName: refreshedSheet.fileName,
    mimeType: refreshedSheet.mimeType,
    bytes: Buffer.from(refreshedSheet.fileData),
  };
  if (sha256Buffer(source.bytes) !== revision.sourceAnswerSheetSha256) {
    throw new AppError(
      409,
      "AI_CHECKED_COPY_SOURCE_CHANGED",
      "Original answer-sheet fingerprint no longer matches this revision",
    );
  }

  const rendered = await renderAIExaminerCheckedCopy({
    source,
    studentName: refreshedSheet.student.user.name,
    examinationName: refreshedSheet.examination.name,
    questions: revision.evaluation.questions.map(question => ({
      questionKey: question.questionKey,
      maxMarks: Number(question.maxMarks),
      finalMarks: Number(question.finalMarks),
      teacherComment: question.teacherComment,
      feedback: question.feedback,
    })),
    annotations: canonicalAnnotations(revision),
    totalMarks: Number(refreshedSheet.marksObtained),
    maximumMarks: refreshedSheet.examination.maximumMarks,
    reviewerName: revision.evaluation.reviewedBy?.name ?? null,
    evaluationRevision: revision.evaluationRevision,
    checkedCopyRevision: revision.revision,
  });

  const renderedHash = sha256Buffer(rendered.pdf);
  const fileName = `${refreshedSheet.fileName.replace(/\.[^.]+$/,"").replace(/[^A-Za-z0-9._-]+/g,"-").slice(0,120)||"answer-sheet"}-checked-r${revision.revision}.pdf`;
  const stored = await systemPrisma.$transaction(async tx => {
    const locked = await tx.aIExaminerCheckedCopyRevision.updateMany({
      where: {
        id: revision.id,
        organizationId: input.organizationId,
        status: AIExaminerCheckedCopyRevisionStatus.APPROVED,
      },
      data: {
        status: AIExaminerCheckedCopyRevisionStatus.RENDERED,
        renderedFileName: fileName,
        renderedMimeType: "application/pdf",
        renderedFileSize: rendered.pdf.length,
        renderedFileData: new Uint8Array(rendered.pdf),
        renderedFileSha256: renderedHash,
        renderedAt: new Date(),
      },
    });
    if (locked.count !== 1) {
      const current = await tx.aIExaminerCheckedCopyRevision.findUnique({ where: { id: revision.id } });
      if (current?.status === AIExaminerCheckedCopyRevisionStatus.RENDERED || current?.status === AIExaminerCheckedCopyRevisionStatus.PUBLISHED) {
        return tx.aIExaminerCheckedCopyRevision.findUniqueOrThrow({ where: { id: revision.id }, include: revisionInclude });
      }
      throw new AppError(
        409,
        "AI_CHECKED_COPY_RENDER_CHANGED",
        "Checked-copy render state changed; refresh before retrying",
      );
    }
    await tx.aIExaminerCheckedCopyRevision.updateMany({
      where: {
        checkedCopyId: revision.checkedCopyId,
        id: { not: revision.id },
        status: { in: [AIExaminerCheckedCopyRevisionStatus.RENDERED, AIExaminerCheckedCopyRevisionStatus.PUBLISHED] },
      },
      data: { status: AIExaminerCheckedCopyRevisionStatus.SUPERSEDED },
    });
    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: "AI_CHECKED_COPY_RENDERED",
        entity: "AIExaminerCheckedCopyRevision",
        entityId: revision.id,
        metadata: {
          renderedFileSha256: renderedHash,
          pageCount: rendered.pageCount,
          placement: rendered.placement,
          source: "FINALIZE_SERVICE",
        },
      },
    });
    return tx.aIExaminerCheckedCopyRevision.findUniqueOrThrow({
      where: { id: revision.id },
      include: revisionInclude,
    });
  });

  return {
    revision: stored,
    alreadyRendered: false,
    placement: rendered.placement,
    pageCount: rendered.pageCount,
  };
}
