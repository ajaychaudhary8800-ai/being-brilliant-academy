import {
  AIExaminerAnnotationApprovalState,
  AIExaminerCheckedCopyRevisionStatus,
  AIExaminerEvaluationStatus,
} from "@prisma/client";
import { ensureAIExaminerCheckedCopyDraft } from "./ai-examiner-checked-copy-draft.js";
import { finalizeAIExaminerCheckedCopyIfReady } from "./ai-examiner-checked-copy-finalize.js";
import { logger } from "./logger.js";
import { systemPrisma } from "./prisma.js";

const RETRY_SOURCE_ACTIONS = [
  "AI_CHECKED_COPY_AUTO_DRAFT_FAILED",
  "AI_CHECKED_COPY_POST_FINALIZE_RETRY_REQUIRED",
] as const;

type RetryOutcome =
  | "DRAFT_READY"
  | "EXCEPTIONS_REMAIN"
  | "RENDERED"
  | "ALREADY_RENDERED"
  | "SKIPPED_RESOLVED"
  | "SKIPPED_INELIGIBLE"
  | "FAILED";

function unresolvedCount(revision: {
  annotations: Array<{
    approvalState: AIExaminerAnnotationApprovalState;
    anchor: unknown | null;
  }>;
}) {
  return revision.annotations.filter(row =>
    row.approvalState !== AIExaminerAnnotationApprovalState.REJECTED &&
    (row.approvalState === AIExaminerAnnotationApprovalState.POSITION_REVIEW_REQUIRED || !row.anchor)
  ).length;
}

export async function processAIExaminerCheckedCopyRetries(limit = 5) {
  const failures = await systemPrisma.auditLog.findMany({
    where: { action: { in: [...RETRY_SOURCE_ACTIONS] } },
    select: {
      id: true,
      organizationId: true,
      actorId: true,
      entityId: true,
      action: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: Math.max(limit * 8, 20),
  });

  const selected = [];
  const seen = new Set<string>();
  for (const failure of failures) {
    const key = `${failure.organizationId}:${failure.entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(failure);
    if (selected.length >= limit) break;
  }

  const results: Array<{
    evaluationId: string;
    outcome: RetryOutcome;
    exceptions?: number;
    error?: string;
  }> = [];

  for (const failure of selected) {
    const recovery = await systemPrisma.auditLog.findFirst({
      where: {
        organizationId: failure.organizationId,
        entity: "AIExaminerEvaluation",
        entityId: failure.entityId,
        action: "AI_CHECKED_COPY_AUTO_RECOVERY_SUCCEEDED",
        createdAt: { gt: failure.createdAt },
      },
      select: { id: true },
    });
    if (recovery) {
      results.push({ evaluationId: failure.entityId, outcome: "SKIPPED_RESOLVED" });
      continue;
    }

    const evaluation = await systemPrisma.aIExaminerEvaluation.findFirst({
      where: {
        id: failure.entityId,
        organizationId: failure.organizationId,
        status: { in: [AIExaminerEvaluationStatus.REVIEW_REQUIRED, AIExaminerEvaluationStatus.APPROVED] },
      },
      select: {
        id: true,
        requestedById: true,
        status: true,
        answerSheet: { select: { finalizedAt: true, marksObtained: true } },
      },
    });
    if (!evaluation) {
      results.push({ evaluationId: failure.entityId, outcome: "SKIPPED_INELIGIBLE" });
      continue;
    }

    try {
      const ensured = await ensureAIExaminerCheckedCopyDraft({
        evaluationId: evaluation.id,
        organizationId: failure.organizationId,
        createdById: failure.actorId ?? evaluation.requestedById,
      });
      const exceptions = unresolvedCount(ensured.revision);
      let outcome: RetryOutcome = "DRAFT_READY";

      if (
        evaluation.status === AIExaminerEvaluationStatus.APPROVED &&
        evaluation.answerSheet.finalizedAt &&
        evaluation.answerSheet.marksObtained != null
      ) {
        if (exceptions === 0) {
          const finalized = await finalizeAIExaminerCheckedCopyIfReady({
            organizationId: failure.organizationId,
            revisionId: ensured.revision.id,
            actorId: failure.actorId ?? evaluation.requestedById,
          });
          outcome = finalized.alreadyRendered ? "ALREADY_RENDERED" : "RENDERED";
        } else {
          outcome = "EXCEPTIONS_REMAIN";
        }
      }

      await systemPrisma.auditLog.create({
        data: {
          organizationId: failure.organizationId,
          actorId: failure.actorId ?? evaluation.requestedById,
          action: "AI_CHECKED_COPY_AUTO_RECOVERY_SUCCEEDED",
          entity: "AIExaminerEvaluation",
          entityId: evaluation.id,
          metadata: {
            retrySourceAction: failure.action,
            retrySourceAuditId: failure.id,
            revisionId: ensured.revision.id,
            revisionStatus: ensured.revision.status,
            exceptions,
            outcome,
          },
        },
      });
      results.push({ evaluationId: evaluation.id, outcome, exceptions });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1000) : "Unknown checked-copy recovery failure";
      await systemPrisma.auditLog.create({
        data: {
          organizationId: failure.organizationId,
          actorId: failure.actorId ?? evaluation.requestedById,
          action: "AI_CHECKED_COPY_AUTO_RECOVERY_FAILED",
          entity: "AIExaminerEvaluation",
          entityId: evaluation.id,
          metadata: {
            retrySourceAction: failure.action,
            retrySourceAuditId: failure.id,
            message,
          },
        },
      }).catch(() => null);
      logger.warn({ evaluationId: evaluation.id, err: error }, "AI checked-copy recovery retry failed");
      results.push({ evaluationId: evaluation.id, outcome: "FAILED", error: message });
    }
  }

  return results;
}
