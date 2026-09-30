import { AIExaminerEvaluationStatus, AIExaminerRubricStatus, AnswerSheetStatus, ExaminationStatus } from "@prisma/client";
import { env } from "../config.js";
import { logger } from "./logger.js";
import { systemPrisma } from "./prisma.js";
import {
  AI_EXAMINER_ENGINE_VERSION,
  AI_EXAMINER_REVIEW_THRESHOLD,
  AIExaminerProviderError,
  evaluateWithAIProvider,
} from "./ai-examiner-engine.js";
import {
  aiExaminerProviderQuestions,
  reconcileAIExaminerProviderResult,
  resolveAIExaminerRubricQuestions,
} from "./ai-examiner-orchestration.js";
import { AIExaminerScoringError } from "./ai-examiner-deterministic.js";
import { parseAIExaminerExamProfile } from "./ai-examiner-exam-profile.js";
import { decideAIExaminerSecondPass } from "./ai-examiner-second-pass.js";

function examProfileHighStakes(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return false;
  const config = (snapshot as Record<string, unknown>).config;
  if (!config) return false;
  try {
    return parseAIExaminerExamProfile(config).highStakes;
  } catch {
    // A malformed assigned profile must fail safe: require stronger verification rather than silently downgrade scrutiny.
    return true;
  }
}

function errorDetails(error: unknown) {
  if (error instanceof AIExaminerProviderError || error instanceof AIExaminerScoringError) return { code: error.code, message: error.message };
  return { code: "AI_EXAMINER_INTERNAL_ERROR", message: error instanceof Error ? error.message : "AI evaluation failed" };
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

    const questions = resolveAIExaminerRubricQuestions(evaluation.rubric.rubric, evaluation.rubric.modelAnswer);
    const providerQuestions = aiExaminerProviderQuestions(questions);
    const result = await evaluateWithAIProvider({
      examination: {
        name: exam.name,
        code: exam.code,
        subjectName: exam.subject.name,
        maximumMarks: exam.maximumMarks,
      },
      instructions: evaluation.rubric.instructions,
      questions: providerQuestions,
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

    const reconciled = reconcileAIExaminerProviderResult(questions, result, AI_EXAMINER_REVIEW_THRESHOLD);
    const total = reconciled.suggestedMarks;
    const confidence = reconciled.confidence;
    const questionRows = reconciled.questions;
    const highStakes = examProfileHighStakes(exam.aiExaminerExamProfileSnapshot);
    const secondPass = decideAIExaminerSecondPass({
      overallConfidence: confidence,
      confidenceThreshold: AI_EXAMINER_REVIEW_THRESHOLD,
      highStakes,
      questions: questionRows.map(question => ({
        questionKey: question.questionKey,
        confidence: question.confidence,
        suggestedMarks: question.suggestedMarks,
        flags: question.flags,
        scoringError: question.scoringError,
        specializedEvidence: question.specializedEvidence,
        evidenceAudit: question.evidenceAudit,
      })),
    });
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
            questionKey: row.questionKey,
            maxMarks: row.maxMarks,
            suggestedMarks: row.suggestedMarks,
            confidence: row.confidence,
            rubricBreakdown: row.rubricBreakdown,
            feedback: row.feedback,
            extractedAnswer: row.extractedAnswer,
            reviewRequired: row.reviewRequired,
          },
        });
      }

      const updated = await tx.aIExaminerEvaluation.update({
        where: { id: evaluation.id },
        data: {
          status: AIExaminerEvaluationStatus.REVIEW_REQUIRED,
          engineVersion: AI_EXAMINER_ENGINE_VERSION,
          provider: new URL(env.AI_EXAMINER_PROVIDER_URL!).hostname,
          model: env.AI_EXAMINER_MODEL,
          extractedText: result.extractedText ?? null,
          suggestedMarks: total,
          confidence,
          feedback: result.overallFeedback,
          diagnostics: {
            ...result.diagnostics,
            questionDiagnostics: questionRows.map(question => ({
              questionKey: question.questionKey,
              concepts: question.concepts,
              flags: question.flags,
              engine: question.engine,
              deterministicStatus: question.deterministicStatus,
              scoringError: question.scoringError,
              specializedEvidence: question.specializedEvidence
                ? JSON.parse(JSON.stringify(question.specializedEvidence))
                : null,
              evidenceAudit: question.evidenceAudit
                ? JSON.parse(JSON.stringify(question.evidenceAudit))
                : null,
            })),
            reviewRequiredCount: questionRows.filter(row => row.reviewRequired).length,
            unresolvedDeterministicCount: reconciled.unresolvedDeterministicCount,
            reviewThreshold: AI_EXAMINER_REVIEW_THRESHOLD,
            secondPassVerification: secondPass,
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
            secondPassRequired: secondPass.required,
            secondPassReasons: secondPass.reasons,
            highStakes,
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
