import {
  AIExaminerAnnotationApprovalState,
  AIExaminerCheckedCopyRevisionStatus,
  AIExaminerEvaluationStatus,
} from "@prisma/client";
import { ensureAIExaminerCheckedCopyDraft } from "./ai-examiner-checked-copy-draft.js";
import { finalizeAIExaminerCheckedCopyIfReady } from "./ai-examiner-checked-copy-finalize.js";
import { checkedCopyRecoveryDecision } from "./ai-examiner-checked-copy-recovery-policy.js";
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

  const selected: Array<(typeof failures)[number] & { entityId: string }> = [];
  const seen = new Set<string>();
  for (const failure of failures) {
    if (!failure.entityId) continue;
    const entityId = failure.entityId;
    const key = `${failure.organizationId}:${entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push({ ...failure, entityId });
    if (selected.length >= limit) break;
  }

  const results: Array<{
    evaluationId: string;
    outcome: RetryOutcome;
    exceptions?: number;
    error?: string;
  }> = [];

  for (const failure of selected) {
    const completedRevision = await systemPrisma.aIExaminerCheckedCopyRevision.findFirst({
      where: {
        organizationId: failure.organizationId,
        evaluationId: failure.entityId,
        status: {
          in: [
            AIExaminerCheckedCopyRevisionStatus.RENDERED,
            AIExaminerCheckedCopyRevisionStatus.PUBLISHED,
          ],
        },
        OR: [
          { renderedAt: { gt: failure.createdAt } },
          { publishedAt: { gt: failure.createdAt } },
        ],
      },
      select: { id: true, status: true },
      orderBy: { revision: "desc" },
    });
    if (completedRevision) {
      results.push({ evaluationId: failure.entityId, outcome: "SKIPPED_RESOLVED" });
      continue;
    }

    const recoveryEvents = await systemPrisma.auditLog.findMany({
      where: {
        organizationId: failure.organizationId,
        entity: "AIExaminerEvaluation",
        entityId: failure.entityId,
        action: {
          in: [
            "AI_CHECKED_COPY_AUTO_RECOVERY_SUCCEEDED",
            "AI_CHECKED_COPY_AUTO_RECOVERY_FAILED",
          ],
        },
        createdAt: { gt: failure.createdAt },
      },
      select: { action: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 32,
    });
    const recoveryDecision = checkedCopyRecoveryDecision(
      recoveryEvents.map(event => ({
        action: event.action as
          | "AI_CHECKED_COPY_AUTO_RECOVERY_SUCCEEDED"
          | "AI_CHECKED_COPY_AUTO_RECOVERY_FAILED",
        createdAt: event.createdAt,
      })),
    );
    if (recoveryDecision.resolved) {
      results.push({ evaluationId: failure.entityId, outcome: "SKIPPED_RESOLVED" });
      continue;
    }
    if (!recoveryDecision.retry) {
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
        answerSheetId: true,
      },
    });
    if (!evaluation) {
      results.push({ evaluationId: failure.entityId, outcome: "SKIPPED_INELIGIBLE" });
      continue;
    }

    try {
      const answerSheet = await systemPrisma.examinationAnswerSheet.findFirst({
        where: {
          id: evaluation.answerSheetId,
          organizationId: failure.organizationId,
        },
        select: { finalizedAt: true, marksObtained: true },
      });
      if (!answerSheet) {
        results.push({ evaluationId: evaluation.id, outcome: "SKIPPED_INELIGIBLE" });
        continue;
      }

      const ensured = await ensureAIExaminerCheckedCopyDraft({
        evaluationId: evaluation.id,
        organizationId: failure.organizationId,
        createdById: failure.actorId ?? evaluation.requestedById,
      });
      const exceptions = unresolvedCount(ensured.revision);
      let outcome: RetryOutcome = "DRAFT_READY";

      if (
        evaluation.status === AIExaminerEvaluationStatus.APPROVED &&
        answerSheet.finalizedAt &&
        answerSheet.marksObtained != null
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
