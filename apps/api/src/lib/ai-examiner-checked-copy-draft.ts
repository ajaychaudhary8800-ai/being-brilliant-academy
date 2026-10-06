import {
  AIExaminerCheckedCopyRevisionStatus,
  AIExaminerEvaluationStatus,
  Prisma,
} from "@prisma/client";
import { AppError } from "./http.js";
import { systemPrisma } from "./prisma.js";
import {
  buildAIExaminerCheckedCopyDraft,
  sha256Buffer,
} from "./ai-examiner-checked-copy-state.js";
import { inspectAIExaminerCheckedCopySource } from "./ai-examiner-checked-copy.js";

export type AIExaminerCheckedCopyDraftMode = "FINAL" | "SUGGESTED";

export async function ensureAIExaminerCheckedCopyDraft(input: {
  evaluationId: string;
  organizationId: string;
  createdById: string;
}) {
  const evaluation = await systemPrisma.aIExaminerEvaluation.findFirst({
    where: {
      id: input.evaluationId,
      organizationId: input.organizationId,
      status: { in: [AIExaminerEvaluationStatus.REVIEW_REQUIRED, AIExaminerEvaluationStatus.APPROVED] },
    },
    include: {
      rubric: { select: { version: true } },
      answerSheet: {
        include: {
          student: { select: { user: { select: { name: true } } } },
          examination: { select: { id: true, maximumMarks: true } },
        },
      },
      questions: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!evaluation) {
    throw new AppError(
      404,
      "AI_EXAMINER_EVALUATION_NOT_FOUND",
      "AI evaluation must be ready for teacher review before creating a checked-copy draft",
    );
  }

  const finalized = evaluation.status === AIExaminerEvaluationStatus.APPROVED;
  const mode: AIExaminerCheckedCopyDraftMode = finalized ? "FINAL" : "SUGGESTED";
  const questionMarks = evaluation.questions.map(question => finalized ? question.finalMarks : question.suggestedMarks);
  const totalMarks = finalized ? evaluation.answerSheet.marksObtained : evaluation.suggestedMarks;

  if (
    finalized &&
    (!evaluation.answerSheet.finalizedAt ||
      evaluation.answerSheet.marksObtained == null ||
      evaluation.questions.some(question => question.finalMarks == null))
  ) {
    throw new AppError(
      409,
      "AI_CHECKED_COPY_GRADING_INCOMPLETE",
      "Approved evaluations require finalized teacher marks before checked-copy annotation review",
    );
  }
  if (questionMarks.some(mark => mark == null) || totalMarks == null) {
    throw new AppError(
      409,
      "AI_CHECKED_COPY_SUGGESTIONS_INCOMPLETE",
      "AI suggested marks are incomplete; finish evaluation processing before checked-copy review",
    );
  }

  const checkedCopy = await systemPrisma.aIExaminerCheckedCopy.upsert({
    where: { answerSheetId: evaluation.answerSheet.id },
    update: {},
    create: {
      organizationId: input.organizationId,
      answerSheetId: evaluation.answerSheet.id,
    },
  });

  const existing = await systemPrisma.aIExaminerCheckedCopyRevision.findFirst({
    where: {
      organizationId: input.organizationId,
      checkedCopyId: checkedCopy.id,
      evaluationId: evaluation.id,
      status: AIExaminerCheckedCopyRevisionStatus.DRAFT,
    },
    include: { annotations: { include: { anchor: true }, orderBy: { sortOrder: "asc" } } },
    orderBy: { revision: "desc" },
  });
  if (existing) return { revision: existing, mode, existing: true };

  const source = {
    fileName: evaluation.answerSheet.fileName,
    mimeType: evaluation.answerSheet.mimeType,
    bytes: Buffer.from(evaluation.answerSheet.fileData),
  };
  const inspected = await inspectAIExaminerCheckedCopySource(source);
  const [latestRevision, result] = await Promise.all([
    systemPrisma.aIExaminerCheckedCopyRevision.findFirst({
      where: { checkedCopyId: checkedCopy.id },
      select: { revision: true },
      orderBy: { revision: "desc" },
    }),
    systemPrisma.examinationResult.findFirst({
      where: {
        organizationId: input.organizationId,
        examinationId: evaluation.answerSheet.examinationId,
        studentId: evaluation.answerSheet.studentId,
      },
      select: { id: true },
    }),
  ]);
  const resultRevision = result
    ? await systemPrisma.aIExaminerResultRevision.findFirst({
        where: { organizationId: input.organizationId, resultId: result.id },
        select: { revision: true },
        orderBy: { revision: "desc" },
      })
    : null;

  const draft = buildAIExaminerCheckedCopyDraft({
    diagnostics: evaluation.diagnostics,
    questions: evaluation.questions.map((question, index) => ({
      questionKey: question.questionKey,
      maxMarks: Number(question.maxMarks),
      finalMarks: Number(questionMarks[index]),
      confidence: question.confidence == null ? null : Number(question.confidence),
      teacherComment: finalized ? question.teacherComment : null,
      feedback: question.feedback,
      rubricBreakdown: question.rubricBreakdown,
    })),
    totalMarks: Number(totalMarks),
    maximumMarks: evaluation.answerSheet.examination.maximumMarks,
    sourcePageCount: inspected.pageCount,
  });

  const revisionNumber = (latestRevision?.revision ?? 0) + 1;
  try {
    const revision = await systemPrisma.$transaction(async tx => {
      const created = await tx.aIExaminerCheckedCopyRevision.create({
        data: {
          organizationId: input.organizationId,
          checkedCopyId: checkedCopy.id,
          evaluationId: evaluation.id,
          revision: revisionNumber,
          sourceAnswerSheetSha256: sha256Buffer(source.bytes),
          evaluationRevision: evaluation.revision,
          rubricVersion: evaluation.rubric.version,
          resultRevision: resultRevision?.revision ?? 0,
          annotationRevision: 1,
          sourcePageCount: inspected.pageCount,
          createdById: input.createdById,
        },
      });
      for (const annotation of draft) {
        await tx.aIExaminerAnnotation.create({
          data: {
            organizationId: input.organizationId,
            revisionId: created.id,
            questionKey: annotation.questionKey,
            rubricCriterion: annotation.rubricCriterion,
            type: annotation.type,
            content: annotation.content,
            marks: annotation.marks,
            confidence: annotation.confidence,
            sourceEvidence: annotation.sourceEvidence,
            ...(annotation.vectorData == null ? {} : { vectorData: annotation.vectorData as Prisma.InputJsonValue }),
            authorType: annotation.authorType,
            approvalState: annotation.approvalState,
            sortOrder: annotation.sortOrder,
            ...(annotation.anchor ? {
              anchor: {
                create: {
                  organizationId: input.organizationId,
                  pageNumber: annotation.anchor.pageNumber,
                  x: annotation.anchor.x,
                  y: annotation.anchor.y,
                  width: annotation.anchor.width,
                  height: annotation.anchor.height,
                  rotation: annotation.anchor.rotation,
                  placementConfidence: annotation.anchor.placementConfidence ?? null,
                  evidenceText: annotation.anchor.evidenceText ?? null,
                },
              },
            } : {}),
          },
        });
      }
      await tx.auditLog.create({
        data: {
          organizationId: input.organizationId,
          actorId: input.createdById,
          action: "AI_CHECKED_COPY_REVISION_CREATED",
          entity: "AIExaminerCheckedCopyRevision",
          entityId: created.id,
          metadata: {
            evaluationId: evaluation.id,
            revision: revisionNumber,
            sourceAnswerSheetSha256: sha256Buffer(source.bytes),
            gradingMode: mode,
            source: "AUTO_DRAFT_SERVICE",
          },
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: input.organizationId,
          actorId: input.createdById,
          action: "AI_CHECKED_COPY_GENERATED",
          entity: "AIExaminerCheckedCopyRevision",
          entityId: created.id,
          metadata: {
            annotationCount: draft.length,
            positionReviewRequired: draft.filter(row => row.approvalState === "POSITION_REVIEW_REQUIRED").length,
            gradingMode: mode,
          },
        },
      });
      return tx.aIExaminerCheckedCopyRevision.findUniqueOrThrow({
        where: { id: created.id },
        include: { annotations: { include: { anchor: true }, orderBy: { sortOrder: "asc" } } },
      });
    });
    return { revision, mode, existing: false };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const concurrent = await systemPrisma.aIExaminerCheckedCopyRevision.findFirst({
        where: {
          organizationId: input.organizationId,
          checkedCopyId: checkedCopy.id,
          evaluationId: evaluation.id,
          status: AIExaminerCheckedCopyRevisionStatus.DRAFT,
        },
        include: { annotations: { include: { anchor: true }, orderBy: { sortOrder: "asc" } } },
        orderBy: { revision: "desc" },
      });
      if (concurrent) return { revision: concurrent, mode, existing: true };
    }
    throw error;
  }
}
