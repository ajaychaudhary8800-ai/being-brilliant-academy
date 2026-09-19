import { AppError } from "./http.js";
import { z } from "zod";

export const bulkTransitionItemSchema = z.object({
  studentId: z.string().cuid(),
  type: z.enum(["PROMOTED", "RETAINED", "TRANSFERRED", "LEFT", "GRADUATED"]),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  targetBatchId: z.string().cuid().optional(),
  rollNo: z.string().trim().toUpperCase().min(1).max(30).optional(),
  reason: z.string().trim().max(2000).nullable().optional(),
});

export type BulkTransitionItem = z.infer<typeof bulkTransitionItemSchema>;

type BulkResult = {
  index: number;
  studentId: string;
  ok: boolean;
  status?: number;
  transition?: { id: string; type: string; effectiveDate: Date; fromEnrollmentId: string; toEnrollmentId: string | null };
  error?: { code: string; message: string };
};

function candidateStudentId(value: unknown) {
  if (!value || typeof value !== "object" || !("studentId" in value)) return "";
  const studentId = (value as { studentId?: unknown }).studentId;
  return typeof studentId === "string" ? studentId : "";
}

function validationResult(index: number, value: unknown, message: string): BulkResult {
  return { index, studentId: candidateStudentId(value), ok: false, status: 422, error: { code: "VALIDATION_ERROR", message } };
}

function safeTransition(value: any) {
  return {
    id: String(value.id),
    type: String(value.type),
    effectiveDate: value.effectiveDate,
    fromEnrollmentId: String(value.fromEnrollmentId),
    toEnrollmentId: value.toEnrollmentId ? String(value.toEnrollmentId) : null,
  };
}

export async function processBulkAcademicTransitions(
  body: unknown,
  execute: (item: BulkTransitionItem, index: number) => Promise<any>,
  onUnexpectedError: (context: { error: unknown; index: number; studentId: string }) => void = () => undefined,
) {
  // Batch 4B intentionally has no durable idempotency key; callers must not blindly replay successful rows.
  if (!body || typeof body !== "object" || !("items" in body) || !Array.isArray((body as { items?: unknown }).items)) {
    throw new AppError(422, "VALIDATION_ERROR", "items must be an array");
  }
  const items = (body as { items: unknown[] }).items;
  if (items.length < 1) throw new AppError(422, "VALIDATION_ERROR", "At least one transition item is required");
  if (items.length > 100) throw new AppError(422, "BULK_LIMIT_EXCEEDED", "A maximum of 100 transition items is allowed");

  const duplicateCandidates = items.map(candidateStudentId).filter(studentId => Boolean(studentId) && z.string().cuid().safeParse(studentId).success);
  const duplicate = duplicateCandidates.find((studentId, index) => duplicateCandidates.indexOf(studentId) !== index);
  if (duplicate) throw new AppError(422, "DUPLICATE_BULK_STUDENT", "A student may appear only once in a bulk transition request");

  const parsed = items.map(item => bulkTransitionItemSchema.safeParse(item));
  const results: BulkResult[] = parsed.map((result, index) => result.success ? { index, studentId: result.data.studentId, ok: false } : validationResult(index, items[index], result.error.issues[0]?.message ?? "Invalid transition item"));
  for (let index = 0; index < parsed.length; index += 1) {
    const result = parsed[index];
    if (!result.success) continue;
    try {
      results[index] = { index, studentId: result.data.studentId, ok: true, transition: safeTransition(await execute(result.data, index)) };
    } catch (error) {
      if (error instanceof AppError) {
        results[index] = { index, studentId: result.data.studentId, ok: false, status: error.status, error: { code: error.code, message: error.message } };
      } else {
        onUnexpectedError({ error, index, studentId: result.data.studentId });
        results[index] = { index, studentId: result.data.studentId, ok: false, status: 500, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } };
      }
    }
  }
  const succeeded = results.filter(result => result.ok).length;
  return { status: succeeded === results.length ? 200 : 207, data: { total: results.length, succeeded, failed: results.length - succeeded, results } };
}
