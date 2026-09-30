import { AIExaminerEvaluationStatus, AIExaminerRubricStatus, AIExaminerScanBindingStatus, AIExaminerScanPageStatus, AnswerSheetStatus, ExaminationStatus, Prisma } from "@prisma/client";
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
  applyAIExaminerCodeVerifications,
  overlayTrustedAIExaminerOmrAnswers,
  reconcileAIExaminerProviderResult,
  resolveAIExaminerRubricQuestions,
} from "./ai-examiner-orchestration.js";
import { AIExaminerScoringError } from "./ai-examiner-deterministic.js";
import { parseAIExaminerExamProfile } from "./ai-examiner-exam-profile.js";
import { decideAIExaminerSecondPass } from "./ai-examiner-second-pass.js";
import { collectTrustedAIExaminerOmrAnswers } from "./ai-examiner-scan-ingestion.js";
import {
  AIExaminerCodeRunnerError,
  runAIExaminerCodeSandbox,
} from "./ai-examiner-code-runner.js";
import {
  evaluateWithIndependentAIExaminerProvider,
  independentAIExaminerProviderConfigured,
  independentAIExaminerProviderReadiness,
} from "./ai-examiner-second-pass-provider.js";

function prismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

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
          scanBinding: {
            include: {
              pages: {
                select: {
                  pageNumber: true,
                  totalPages: true,
                  status: true,
                  validationResult: true,
                  scannerEngine: true,
                  scannerVersion: true,
                },
                orderBy: { pageNumber: "asc" },
              },
            },
          },
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

    const scanBinding = evaluation.answerSheet.scanBinding;
    const omrQuestionKeys = questions.filter(question => question.omrValidation).map(question => question.key);
    let scoringResult = result;
    let omrEvidence = {
      available: Boolean(scanBinding),
      trusted: false,
      reason: scanBinding ? "OMR scan binding is not locked with fully accepted pages" : null as string | null,
      appliedQuestionKeys: [] as string[],
      pageCount: scanBinding?.pages.length ?? 0,
      scanners: scanBinding
        ? [...new Set(scanBinding.pages.map(page => `${page.scannerEngine}@${page.scannerVersion}`))]
        : [] as string[],
    };

    if (
      scanBinding?.status === AIExaminerScanBindingStatus.LOCKED &&
      scanBinding.pages.length > 0 &&
      scanBinding.pages.every(page => page.status === AIExaminerScanPageStatus.ACCEPTED)
    ) {
      const collected = collectTrustedAIExaminerOmrAnswers(scanBinding.pages.map(page => page.validationResult));
      if (collected.valid) {
        const overlaid = overlayTrustedAIExaminerOmrAnswers(questions, result, collected.answers);
        scoringResult = overlaid.result;
        omrEvidence = {
          ...omrEvidence,
          trusted: true,
          reason: null,
          appliedQuestionKeys: overlaid.appliedQuestionKeys,
        };
      } else {
        omrEvidence = { ...omrEvidence, reason: collected.reason };
      }
    }

    let reconciled = reconcileAIExaminerProviderResult(questions, scoringResult, AI_EXAMINER_REVIEW_THRESHOLD);

    const codeVerifications = new Map();
    const codeExecutionDiagnostics: Array<Record<string, unknown>> = [];
    for (const question of questions.filter(item => item.questionType === "PROGRAMMING" || item.requiresCodeExecution)) {
      const row = reconciled.questions.find(item => item.questionKey.toLocaleLowerCase("en") === question.key.toLocaleLowerCase("en"));
      if (!row?.extractedAnswer || !question.codeExecution) {
        codeExecutionDiagnostics.push({
          questionKey: question.key,
          status: "NOT_RUN",
          code: !row?.extractedAnswer ? "AI_EXAMINER_CODE_SOURCE_NOT_EXTRACTED" : "AI_EXAMINER_CODE_POLICY_MISSING",
        });
        continue;
      }
      try {
        const executed = await runAIExaminerCodeSandbox({
          submissionId: `${evaluation.id}:${question.key}`,
          sourceCode: row.extractedAnswer,
          policy: question.codeExecution,
        });
        codeVerifications.set(question.key.toLocaleLowerCase("en"), executed.verification);
        codeExecutionDiagnostics.push({
          questionKey: question.key,
          status: "COMPLETED",
          executionId: executed.result.executionId,
          runnerStatus: executed.result.status,
          executionAccepted: executed.verification.executionAccepted,
          passedWeight: executed.verification.passedWeight,
          totalWeight: executed.verification.totalWeight,
          scoreFraction: executed.verification.scoreFraction,
        });
      } catch (error) {
        const code = error instanceof AIExaminerCodeRunnerError ? error.code : "AI_EXAMINER_CODE_RUNNER_INTERNAL_ERROR";
        codeExecutionDiagnostics.push({
          questionKey: question.key,
          status: "FAILED",
          code,
          message: error instanceof Error ? error.message.slice(0, 1000) : "Code runner failed",
        });
      }
    }
    if (codeVerifications.size) {
      reconciled = applyAIExaminerCodeVerifications({ reconciled, questions, verifications: codeVerifications });
    }

    const total = reconciled.suggestedMarks;
    const confidence = reconciled.confidence;
    const questionRows = reconciled.questions;
    const highStakes = examProfileHighStakes(exam.aiExaminerExamProfileSnapshot);
    const secondPass = decideAIExaminerSecondPass({
      overallConfidence: confidence,
      confidenceThreshold: AI_EXAMINER_REVIEW_THRESHOLD,
      highStakes,
      omrReviewRequired: Boolean(scanBinding) && !omrEvidence.trusted,
      omrQuestionKeys,
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
    let secondPassExecution: Record<string, unknown> = {
      required: secondPass.required,
      status: secondPass.required ? "NOT_CONFIGURED" : "NOT_REQUIRED",
      readiness: independentAIExaminerProviderReadiness(),
      targets: [],
    };
    if (secondPass.required && independentAIExaminerProviderConfigured()) {
      try {
        let verificationResult = await evaluateWithIndependentAIExaminerProvider({
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
        if (omrEvidence.trusted) {
          const trusted = collectTrustedAIExaminerOmrAnswers(scanBinding!.pages.map(page => page.validationResult));
          if (trusted.valid) {
            verificationResult = overlayTrustedAIExaminerOmrAnswers(questions, verificationResult, trusted.answers).result;
          }
        }
        const independent = reconcileAIExaminerProviderResult(questions, verificationResult, AI_EXAMINER_REVIEW_THRESHOLD);
        const targetSet = new Set(secondPass.questionKeys.map(key => key.toLocaleLowerCase("en")));
        const comparisons = questionRows
          .filter(row => targetSet.has(row.questionKey.toLocaleLowerCase("en")))
          .map(primary => {
            const verifier = independent.questions.find(row => row.questionKey.toLocaleLowerCase("en") === primary.questionKey.toLocaleLowerCase("en"));
            const difference = primary.suggestedMarks != null && verifier?.suggestedMarks != null
              ? Math.round(Math.abs(primary.suggestedMarks - verifier.suggestedMarks) * 10000) / 10000
              : null;
            const threshold = Math.max(0.5, primary.maxMarks * 0.1);
            return {
              questionKey: primary.questionKey,
              primaryMarks: primary.suggestedMarks,
              verifierMarks: verifier?.suggestedMarks ?? null,
              primaryConfidence: primary.confidence,
              verifierConfidence: verifier?.confidence ?? null,
              marksDifference: difference,
              discrepancyThreshold: threshold,
              materiallyDiscrepant: difference == null ? true : difference > threshold,
              verifierFlags: verifier?.flags ?? [],
              verifierReviewRequired: verifier?.reviewRequired ?? true,
            };
          });
        secondPassExecution = {
          required: true,
          status: "COMPLETED",
          readiness: independentAIExaminerProviderReadiness(),
          verifierProvider: new URL(env.AI_EXAMINER_SECOND_PASS_PROVIDER_URL!).hostname,
          verifierModel: env.AI_EXAMINER_SECOND_PASS_MODEL,
          targets: comparisons,
          materialDiscrepancyCount: comparisons.filter(item => item.materiallyDiscrepant).length,
          verifierOverallConfidence: independent.confidence,
        };
      } catch (error) {
        secondPassExecution = {
          required: true,
          status: "FAILED",
          readiness: independentAIExaminerProviderReadiness(),
          code: error instanceof AIExaminerProviderError ? error.code : "AI_EXAMINER_SECOND_PASS_INTERNAL_ERROR",
          message: error instanceof Error ? error.message.slice(0, 1000) : "Independent verification failed",
          targets: secondPass.questionKeys,
        };
      }
    }

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
          diagnostics: prismaJson({
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
            secondPassExecution,
            codeExecution: codeExecutionDiagnostics,
            omrEvidence,
          }),
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
          metadata: prismaJson({
            answerSheetId: evaluation.answerSheetId,
            suggestedMarks: total,
            confidence,
            reviewRequiredCount: questionRows.filter(row => row.reviewRequired).length,
            secondPassRequired: secondPass.required,
            secondPassReasons: secondPass.reasons,
            secondPassExecutionStatus: secondPassExecution.status,
            codeExecutionCompletedCount: codeExecutionDiagnostics.filter(item => item.status === "COMPLETED").length,
            highStakes,
            omrEvidenceTrusted: omrEvidence.trusted,
            omrAppliedQuestionCount: omrEvidence.appliedQuestionKeys.length,
            engineVersion: AI_EXAMINER_ENGINE_VERSION,
          }),
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
