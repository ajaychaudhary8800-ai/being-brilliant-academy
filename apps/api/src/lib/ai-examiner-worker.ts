import { AIExaminerEvaluationStatus, AIExaminerRubricStatus, AnswerSheetStatus, ExaminationStatus } from "@prisma/client";
import { env } from "../config.js";
import { logger } from "./logger.js";
import { systemPrisma } from "./prisma.js";
import {
  AI_EXAMINER_ENGINE_VERSION,
  AI_EXAMINER_REVIEW_THRESHOLD,
  AIExaminerProviderError,
  evaluateWithAIProvider,
  type AIExaminerRubricQuestion,
} from "./ai-examiner-engine.js";
import { aiExaminerConfidenceNeedsReview } from "./ai-examiner-policy.js";

function errorDetails(error: unknown) {
  if (error instanceof AIExaminerProviderError) return { code: error.code, message: error.message };
  return { code: "AI_EXAMINER_INTERNAL_ERROR", message: error instanceof Error ? error.message : "AI evaluation failed" };
}

function parseRubric(value: unknown, modelAnswer: unknown): AIExaminerRubricQuestion[] {
  const rubric = value && typeof value === "object" && "questions" in value
    ? (value as { questions?: unknown[] }).questions
    : null;
  if (!Array.isArray(rubric)) throw new AIExaminerProviderError("AI_EXAMINER_RUBRIC_INVALID", "Active rubric has no question definitions");

  const answers = new Map<string, string>();
  if (modelAnswer && typeof modelAnswer === "object" && "questions" in modelAnswer) {
    const rows = (modelAnswer as { questions?: unknown[] }).questions;
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const key = "key" in row ? String((row as { key?: unknown }).key ?? "") : "";
        const answer = "answer" in row ? String((row as { answer?: unknown }).answer ?? "") : "";
        if (key && answer) answers.set(key.toLowerCase(), answer);
      }
    }
  }

  return rubric.map((row, index) => {
    if (!row || typeof row !== "object") throw new AIExaminerProviderError("AI_EXAMINER_RUBRIC_INVALID", `Rubric question ${index + 1} is invalid`);
    const source = row as Record<string, unknown>;
    const key = String(source.key ?? "").trim();
    const maxMarks = Number(source.maxMarks);
    const criteria = String(source.criteria ?? "").trim();
    const concepts = Array.isArray(source.concepts) ? source.concepts.map(value => String(value).trim()).filter(Boolean) : [];
    if (!key || !Number.isFinite(maxMarks) || maxMarks <= 0 || !criteria) {
      throw new AIExaminerProviderError("AI_EXAMINER_RUBRIC_INVALID", `Rubric question ${index + 1} is incomplete`);
    }
    return { key, maxMarks, criteria, concepts, modelAnswer: answers.get(key.toLowerCase()) ?? null };
  });
}

async function restoreAnswerSheetAfterFailure(answerSheetId: string, organizationId: string, isLate: boolean) {
  await systemPrisma.examinationAnswerSheet.updateMany({
    where: {
      id: answerSheetId,
      organizationId,
      status: AnswerSheetStatus.UNDER_REVIEW,
      finalizedAt: null,
      aiEvaluations: { none: { status: { in: [AIExaminerEvaluationStatus.QUEUED, AIExaminerEvaluationStatus.PROCESSING, AIExaminerEvaluationStatus.REVIEW_REQUIRED] } } },
    },
    data: { status: isLate ? AnswerSheetStatus.LATE_SUBMITTED : AnswerSheetStatus.SUBMITTED },
  });
}

export async function runAIExaminerEvaluation(evaluationId: string) {
  const claimed = await systemPrisma.aIExaminerEvaluation.updateMany({
    where: { id: evaluationId, status: AIExaminerEvaluationStatus.QUEUED },
    data: { status: AIExaminerEvaluationStatus.PROCESSING, startedAt: new Date(), errorCode: null, errorMessage: null },
  });
  if (!claimed.count) return { processed: false, reason: "NOT_QUEUED" as const };

  const evaluation = await systemPrisma.aIExaminerEvaluation.findUnique({
    where: { id: evaluationId },
    include: {
      rubric: true,
      answerSheet: {
        include: {
          questionPaper: true,
          examination: {
            include: {
              subject: { select: { name: true } },
              questionPaper: true,
            },
          },
        },
      },
    },
  });
  if (!evaluation) return { processed: false, reason: "NOT_FOUND" as const };

  try {
    const exam = evaluation.answerSheet.examination;
    const paper = evaluation.answerSheet.questionPaper ?? exam.questionPaper;
    if (exam.status !== ExaminationStatus.COMPLETED) throw new AIExaminerProviderError("AI_EXAMINER_EXAM_NOT_COMPLETED", "Examination is no longer open for AI evaluation");
    if (!paper?.publishedAt) throw new AIExaminerProviderError("AI_EXAMINER_QUESTION_PAPER_REQUIRED", "Published question paper is required");
    if (evaluation.rubric.status !== AIExaminerRubricStatus.ACTIVE) throw new AIExaminerProviderError("AI_EXAMINER_ACTIVE_RUBRIC_REQUIRED", "The evaluation rubric is no longer active");
    if (evaluation.answerSheet.finalizedAt) throw new AIExaminerProviderError("AI_EXAMINER_ANSWER_FINALIZED", "Answer sheet was finalized before AI evaluation completed");

    const questions = parseRubric(evaluation.rubric.rubric, evaluation.rubric.modelAnswer);
    const result = await evaluateWithAIProvider({
      examination: {
        name: exam.name,
        code: exam.code,
        subjectName: exam.subject.name,
        maximumMarks: exam.maximumMarks,
      },
      instructions: evaluation.rubric.instructions,
      questions,
      questionPaper: {
        fileName: paper.fileName,
        mimeType: paper.mimeType,
        bytes: Buffer.from(paper.fileData),
      },
      answerSheet: {
        fileName: evaluation.answerSheet.fileName,
        mimeType: evaluation.answerSheet.mimeType,
        bytes: Buffer.from(evaluation.answerSheet.fileData),
      },
    });

    const total = result.questions.reduce((sum, question) => sum + question.awardedMarks, 0);
    const questionConfidence = result.questions.reduce((sum, question) => sum + question.confidence, 0) / result.questions.length;
    const confidence = Math.min(result.confidence, questionConfidence);
    const questionRows = result.questions.map(question => ({
      question,
      reviewRequired:
        aiExaminerConfidenceNeedsReview(question.confidence, AI_EXAMINER_REVIEW_THRESHOLD) ||
        question.flags.length > 0,
    }));
    const completedAt = new Date();

    const persisted = await systemPrisma.$transaction(async tx => {
      const stillOpen = await tx.examinationAnswerSheet.findFirst({
        where: {
          id: evaluation.answerSheetId,
          organizationId: evaluation.organizationId,
          finalizedAt: null,
          examination: { status: ExaminationStatus.COMPLETED },
        },
        select: { id: true },
      });
      if (!stillOpen) throw new AIExaminerProviderError("AI_EXAMINER_EVALUATION_CLOSED", "Answer sheet was finalized while AI evaluation was running");

      await tx.aIExaminerQuestionEvaluation.deleteMany({ where: { evaluationId: evaluation.id } });
      for (const row of questionRows) {
        await tx.aIExaminerQuestionEvaluation.create({
          data: {
            organizationId: evaluation.organizationId,
            evaluationId: evaluation.id,
            questionKey: row.question.questionKey,
            maxMarks: row.question.maxMarks,
            suggestedMarks: row.question.awardedMarks,
            confidence: row.question.confidence,
            rubricBreakdown: row.question.rubricBreakdown,
            feedback: row.question.feedback,
            extractedAnswer: row.question.extractedAnswer ?? null,
            reviewRequired: row.reviewRequired,
          },
        });
      }

      const updated = await tx.aIExaminerEvaluation.update({
        where: { id: evaluation.id },
        data: {
          status: AIExaminerEvaluationStatus.REVIEW_REQUIRED,
          engineVersion: AI_EXAMINER_ENGINE_VERSION,
          provider: new URL(env.AI_PROVIDER_URL!).hostname,
          model: env.AI_MODEL,
          extractedText: result.extractedText ?? null,
          suggestedMarks: total,
          confidence,
          feedback: result.overallFeedback,
          diagnostics: {
            ...result.diagnostics,
            questionDiagnostics: result.questions.map(question => ({
              questionKey: question.questionKey,
              concepts: question.concepts,
              flags: question.flags,
            })),
            reviewRequiredCount: questionRows.filter(row => row.reviewRequired).length,
            reviewThreshold: AI_EXAMINER_REVIEW_THRESHOLD,
          },
          completedAt,
          errorCode: null,
          errorMessage: null,
        },
        select: { id: true, status: true, suggestedMarks: true, confidence: true, completedAt: true },
      });
      await tx.auditLog.create({
        data: {
          organizationId: evaluation.organizationId,
          actorId: evaluation.requestedById,
          action: "AI_EXAMINER_EVALUATION_COMPLETED",
          entity: "AIExaminerEvaluation",
          entityId: evaluation.id,
          metadata: {
            answerSheetId: evaluation.answerSheetId,
            suggestedMarks: total,
            confidence,
            reviewRequiredCount: questionRows.filter(row => row.reviewRequired).length,
            engineVersion: AI_EXAMINER_ENGINE_VERSION,
          },
        },
      });
      return updated;
    });

    return { processed: true, evaluation: persisted };
  } catch (error) {
    const details = errorDetails(error);
    const failedAt = new Date();
    await systemPrisma.aIExaminerEvaluation.updateMany({
      where: { id: evaluation.id, status: AIExaminerEvaluationStatus.PROCESSING },
      data: {
        status: AIExaminerEvaluationStatus.FAILED,
        completedAt: failedAt,
        errorCode: details.code.slice(0, 191),
        errorMessage: details.message.slice(0, 5000),
      },
    });
    await restoreAnswerSheetAfterFailure(evaluation.answerSheetId, evaluation.organizationId, evaluation.answerSheet.isLate);
    await systemPrisma.auditLog.create({
      data: {
        organizationId: evaluation.organizationId,
        actorId: evaluation.requestedById,
        action: "AI_EXAMINER_EVALUATION_FAILED",
        entity: "AIExaminerEvaluation",
        entityId: evaluation.id,
        metadata: { answerSheetId: evaluation.answerSheetId, errorCode: details.code, errorMessage: details.message.slice(0, 1000) },
      },
    }).catch(() => null);
    logger.error({ evaluationId: evaluation.id, code: details.code, err: error }, "AI Examiner evaluation failed");
    return { processed: true, failed: true, error: details };
  }
}

export async function processQueuedAIExaminerEvaluations(limit = 2) {
  const queued = await systemPrisma.aIExaminerEvaluation.findMany({
    where: { status: AIExaminerEvaluationStatus.QUEUED },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  const results = [];
  for (const row of queued) results.push(await runAIExaminerEvaluation(row.id));
  return results;
}
