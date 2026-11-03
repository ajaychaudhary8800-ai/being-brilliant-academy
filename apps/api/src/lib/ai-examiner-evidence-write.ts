import { Prisma } from "@prisma/client";
import { AppError } from "./http.js";
import { assertAIExaminerEvidenceMutable } from "./ai-examiner-policy.js";

/**
 * Serializes evidence creation/status mutations against final human approval.
 * Human finalization writes ExaminationAnswerSheet, so both operations take
 * its row lock. Read-before-write checks alone allow post-finalization changes.
 *
 * Keep all mutation side effects inside the caller's transaction. The caller
 * must independently authenticate and authorize access to the exam.
 */
export async function lockMutableEvidenceAnswerSheet(
  tx: Prisma.TransactionClient,
  organizationId: string,
  answerSheetId: string,
) {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "ExaminationAnswerSheet"
    WHERE "id" = ${answerSheetId} AND "organizationId" = ${organizationId}
    FOR UPDATE
  `;
  if (locked.length !== 1) throw new AppError(404, "ANSWER_SHEET_NOT_FOUND", "Answer sheet not found");

  const sheet = await tx.examinationAnswerSheet.findFirst({
    where: { id: answerSheetId, organizationId },
    select: { finalizedAt: true },
  });
  if (!sheet) throw new AppError(404, "ANSWER_SHEET_NOT_FOUND", "Answer sheet not found");
  assertAIExaminerEvidenceMutable(sheet.finalizedAt);
}
