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
    const student = students[result.index];
    const transition = result.transition;
    const roll = bulkTransitionNeedsDestination(context.type) ? normalizeTransitionRollNo(context.rolls?.[result.studentId] ?? "") : "";
    return [result.index + 1, student?.user.name ?? "", result.studentId, context.type, context.effectiveDate, bulkTransitionNeedsDestination(context.type) ? context.destinationName ?? "" : "", roll, result.ok ? "Success" : "Failed", result.ok ? 200 : result.status ?? response.httpStatus, result.error?.code ?? "", result.error?.message ?? "", transition?.id ?? ""];
  });
  return `\uFEFF${[headers, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
