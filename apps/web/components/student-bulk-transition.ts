import { destinationTransitionTypes, localCivilDate, normalizeTransitionRollNo, type StudentTransitionType } from "./student-transition";

export const BULK_TRANSITION_LIMIT = 100;

export type BulkStudent = {
  id: string;
  admissionNo?: string;
  rollNo?: string | null;
  user: { name: string };
  branch?: { id: string; name?: string };
  course?: { id: string; title: string } | null;
  batch?: { id: string; name: string };
  academicSession?: string;
  currentEnrollment?: { batchId?: string; courseId?: string | null; rollNo?: string | null } | null;
};

export type BulkTransitionDraft = {
  type: StudentTransitionType;
  effectiveDate: string;
  targetBatchId?: string;
  reason?: string;
};

export type BulkTransitionResult = {
  index: number;
  studentId: string;
  ok: boolean;
  status?: number;
  transition?: { id: string; type: string; effectiveDate: string; fromEnrollmentId: string; toEnrollmentId: string | null };
  error?: { code: string; message: string };
};

export type BulkTransitionResponse = {
  httpStatus: number;
  data: { total: number; succeeded: number; failed: number; results: BulkTransitionResult[] };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseBulkTransitionResponse(value: unknown, httpStatus: number, students: BulkStudent[]): BulkTransitionResponse {
  if (!isRecord(value) || !isRecord(value.data)) throw new Error("The bulk transition response was invalid.");
  const data = value.data;
  const rawResults = data.results;
  if (!Array.isArray(rawResults)) throw new Error("The bulk transition response was invalid.");
  if (!isNonNegativeInteger(data.total) || !isNonNegativeInteger(data.succeeded) || !isNonNegativeInteger(data.failed) || data.total !== students.length || rawResults.length !== data.total || data.succeeded + data.failed !== data.total) {
    throw new Error("The bulk transition response summary was invalid.");
  }
  const seen = new Set<string>();
  const results: BulkTransitionResult[] = rawResults.map((candidate: unknown) => {
    if (!isRecord(candidate) || !isNonNegativeInteger(candidate.index) || candidate.index >= students.length || typeof candidate.studentId !== "string" || !candidate.studentId || candidate.studentId !== students[candidate.index]?.id || seen.has(candidate.studentId) || typeof candidate.ok !== "boolean") throw new Error("The bulk transition response did not match the submitted students.");
    seen.add(candidate.studentId);
    if (candidate.ok && (!isRecord(candidate.transition) || !isNonEmptyString(candidate.transition.id) || !isNonEmptyString(candidate.transition.type) || typeof candidate.transition.effectiveDate !== "string" || !isNonEmptyString(candidate.transition.fromEnrollmentId) || !(candidate.transition.toEnrollmentId === null || typeof candidate.transition.toEnrollmentId === "string"))) throw new Error("The bulk transition response was missing a successful transition.");
    const result: BulkTransitionResult = { index: candidate.index, studentId: candidate.studentId, ok: candidate.ok };
    if (typeof candidate.status === "number" && Number.isFinite(candidate.status)) result.status = candidate.status;
    if (isRecord(candidate.transition)) result.transition = { id: candidate.transition.id as string, type: candidate.transition.type as string, effectiveDate: candidate.transition.effectiveDate as string, fromEnrollmentId: candidate.transition.fromEnrollmentId as string, toEnrollmentId: candidate.transition.toEnrollmentId as string | null };
    if (isRecord(candidate.error)) result.error = { code: typeof candidate.error.code === "string" ? candidate.error.code : "ERROR", message: typeof candidate.error.message === "string" ? candidate.error.message : "Unable to process this student." };
    return result;
  });
  if (seen.size !== students.length) throw new Error("The bulk transition response did not include every submitted student.");
  const actualSucceeded = results.filter(result => result.ok).length;
  const actualFailed = results.length - actualSucceeded;
  if (data.succeeded !== actualSucceeded || data.failed !== actualFailed) throw new Error("The bulk transition response summary was invalid.");
  return { httpStatus, data: { total: data.total, succeeded: data.succeeded, failed: data.failed, results } };
}

export function selectionState<T extends BulkStudent>(students: T[], selection: Map<string, T>) {
  const selectedOnPage = students.filter(student => selection.has(student.id)).length;
  return { selectedOnPage, allDisplayedSelected: students.length > 0 && selectedOnPage === students.length, someDisplayedSelected: selectedOnPage > 0 && selectedOnPage < students.length };
}

export type BulkResultsCsvContext = {
  type: StudentTransitionType;
  effectiveDate: string;
  destinationName?: string;
  rolls?: Record<string, string>;
};

export function bulkTransitionNeedsDestination(type: StudentTransitionType) {
  return destinationTransitionTypes.includes(type);
}

export function initialBulkRollNumbers(students: BulkStudent[]) {
  return Object.fromEntries(students.map(student => [student.id, student.currentEnrollment?.rollNo ?? student.rollNo ?? ""]));
}

export function normalizeBulkRollNumbers(values: Record<string, string>) {
  return Object.fromEntries(Object.entries(values).map(([id, value]) => [id, normalizeTransitionRollNo(value)]));
}

export function duplicateBulkRollNumbers(students: BulkStudent[], values: Record<string, string>, type: StudentTransitionType) {
  if (!bulkTransitionNeedsDestination(type)) return [];
  const normalized = normalizeBulkRollNumbers(values);
  const seen = new Map<string, string>();
  const duplicates: string[] = [];
  for (const student of students) {
    const roll = normalized[student.id] ?? "";
    if (!roll) continue;
    const previous = seen.get(roll);
    if (previous && !duplicates.includes(roll)) duplicates.push(roll);
    else if (!previous) seen.set(roll, student.id);
  }
  return duplicates;
}

export function buildBulkTransitionPayload(students: BulkStudent[], draft: BulkTransitionDraft, rolls: Record<string, string>) {
  const destination = bulkTransitionNeedsDestination(draft.type);
  const reason = draft.reason?.trim();
  return {
    items: students.map(student => ({
      studentId: student.id,
      type: draft.type,
      effectiveDate: draft.effectiveDate,
      ...(destination && draft.targetBatchId ? { targetBatchId: draft.targetBatchId } : {}),
      ...(destination && rolls[student.id]?.trim() ? { rollNo: normalizeTransitionRollNo(rolls[student.id]!) } : {}),
      ...(reason ? { reason } : {}),
    })),
  };
}

export function selectionWithStudent<T extends BulkStudent>(selection: Map<string, T>, student: T) {
  if (selection.has(student.id)) return selection;
  if (selection.size >= BULK_TRANSITION_LIMIT) return selection;
  const next = new Map(selection);
  next.set(student.id, student);
  return next;
}

export function selectionWithoutStudent<T extends BulkStudent>(selection: Map<string, T>, id: string) {
  const next = new Map(selection);
  next.delete(id);
  return next;
}

export function localResultsFilename(date = localCivilDate()) {
  return `academic-transition-results-${date}.csv`;
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function buildBulkResultsCsv(response: BulkTransitionResponse, students: BulkStudent[], context: BulkResultsCsvContext) {
  const headers = ["Result Index", "Student Name", "Student ID", "Transition Type", "Effective Date", "Destination Batch/Group", "Destination Roll Number", "Result", "HTTP Status", "Error Code", "Error Message", "Transition ID"];
  const rows = response.data.results.map(result => {
    const student = students.find(candidate => candidate.id === result.studentId);
    const transition = result.transition;
    const roll = bulkTransitionNeedsDestination(context.type) ? normalizeTransitionRollNo(context.rolls?.[result.studentId] ?? "") : "";
    return [result.index + 1, student?.user.name ?? "", result.studentId, context.type, context.effectiveDate, bulkTransitionNeedsDestination(context.type) ? context.destinationName ?? "" : "", roll, result.ok ? "Success" : "Failed", result.ok ? 200 : result.status ?? response.httpStatus, result.error?.code ?? "", result.error?.message ?? "", transition?.id ?? ""];
  });
  return `\uFEFF${[headers, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
