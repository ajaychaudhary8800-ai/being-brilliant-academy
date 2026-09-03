import { AnswerSheetStatus, ExaminationResultStatus, ExaminationStatus, Role } from "@prisma/client";
import { AppError } from "./http.js";

export function assertEvaluationOpen(finalizedAt: Date | null) {
  if (finalizedAt) throw new AppError(409, "EVALUATION_FINALIZED", "A finalized evaluation cannot be modified; an explicit reopen workflow is required");
}

export const replaceableAnswerSheetStatuses: AnswerSheetStatus[] = [AnswerSheetStatus.SUBMITTED, AnswerSheetStatus.LATE_SUBMITTED];

export function assertAnswerSheetReplaceable(status: AnswerSheetStatus, finalizedAt: Date | null) {
  if (finalizedAt || !replaceableAnswerSheetStatuses.includes(status)) {
    throw new AppError(409, "SUBMISSION_FINALIZED", "An answer sheet cannot be replaced after review has started");
  }
}

export function assertSingleConditionalMutation(count: number, code: string, message: string) {
  if (count !== 1) throw new AppError(409, code, message);
}

export function assertExaminationManager(role: Role, userId: string, assignedTeacherUserId: string) {
  if (role === Role.SUPER_ADMIN || role === Role.BRANCH_ADMIN || role === Role.TEACHER && userId === assignedTeacherUserId) return;
  throw new AppError(403, "EXAMINATION_ACCESS_DENIED", "This examination is not assigned to you");
}

export function assertAnswerSheetAccess(role: Role, userId: string, studentUserId: string, assignedTeacherUserId: string) {
  if (role === Role.STUDENT && userId === studentUserId) return;
  assertExaminationManager(role, userId, assignedTeacherUserId);
}

export function evaluationStatus(finalize: boolean) {
  return finalize ? AnswerSheetStatus.EVALUATED : AnswerSheetStatus.UNDER_REVIEW;
}

export function examinationResultFor(marks: number, maximumMarks: number, passingMarks: number, now = new Date()) {
  const percentage = maximumMarks ? marks / maximumMarks * 100 : 0;
  return { marksObtained: marks, percentage, status: marks >= passingMarks ? ExaminationResultStatus.PASS : ExaminationResultStatus.FAIL, generatedAt: now };
}

export function assertStudentExaminationEligible<T extends { batchId: string; academicSessionId: string }>(student: T | null, exam: { batchId: string; academicSessionId: string }): asserts student is T {
  if (!student || student.batchId !== exam.batchId || student.academicSessionId !== exam.academicSessionId) throw new AppError(403, "EXAMINATION_ACCESS_DENIED", "This examination is not assigned to your batch and academic session");
}

export function assertStudentExaminationPublished(status: ExaminationStatus) {
  const publishedStatuses: ExaminationStatus[] = [ExaminationStatus.SCHEDULED, ExaminationStatus.COMPLETED, ExaminationStatus.RESULTS_PUBLISHED];
  if (!publishedStatuses.includes(status)) throw new AppError(403, "EXAMINATION_UNPUBLISHED", "This examination is not published for student access");
}

export function examinationStart(exam: { examDate: Date; startMinute: number }) {
  const value = new Date(exam.examDate);
  value.setUTCHours(Math.floor(exam.startMinute / 60), exam.startMinute % 60, 0, 0);
  return value;
}

export function examinationEnd(exam: { examDate: Date; endMinute: number }) {
  const value = new Date(exam.examDate);
  value.setUTCHours(Math.floor(exam.endMinute / 60), exam.endMinute % 60, 0, 0);
  return value;
}

export function answerSubmissionState(exam: { examDate: Date; startMinute: number; endMinute: number; status: ExaminationStatus }, now = new Date()) {
  const start = examinationStart(exam), end = examinationEnd(exam);
  if (now < start) throw new AppError(409, "SUBMISSION_NOT_OPEN", "Answer submission is not open before the examination starts");
  if (now <= end && exam.status === ExaminationStatus.SCHEDULED) return { status: AnswerSheetStatus.SUBMITTED, examinationStatus: ExaminationStatus.SCHEDULED };
  if (now > end && exam.status === ExaminationStatus.COMPLETED) return { status: AnswerSheetStatus.LATE_SUBMITTED, examinationStatus: ExaminationStatus.COMPLETED };
  throw new AppError(409, "SUBMISSION_UNAVAILABLE", "Answer submission is closed for the current examination lifecycle");
}

export function publishedEvaluation<T extends { marksObtained: unknown; teacherRemarks: unknown; finalizedAt: Date | null }>(status: ExaminationStatus, sheet: T) {
  return status === ExaminationStatus.RESULTS_PUBLISHED && sheet.finalizedAt
    ? sheet
    : { ...sheet, marksObtained: null, teacherRemarks: null };
}

const legalTransitions: Record<ExaminationStatus, ExaminationStatus[]> = {
  [ExaminationStatus.DRAFT]: [ExaminationStatus.SCHEDULED, ExaminationStatus.ARCHIVED],
  [ExaminationStatus.SCHEDULED]: [ExaminationStatus.COMPLETED, ExaminationStatus.ARCHIVED],
  [ExaminationStatus.COMPLETED]: [ExaminationStatus.RESULTS_PUBLISHED, ExaminationStatus.ARCHIVED],
  [ExaminationStatus.RESULTS_PUBLISHED]: [ExaminationStatus.ARCHIVED],
  [ExaminationStatus.ARCHIVED]: [],
};

export function assertExaminationStatusTransition(current: ExaminationStatus, next: ExaminationStatus) {
  if (current === next) return;
  if (!legalTransitions[current].includes(next)) throw new AppError(409, "INVALID_EXAMINATION_STATUS_TRANSITION", `Examination status cannot change from ${current} to ${next}`);
}

export const examinationCoreFields = ["type", "branchId", "courseId", "batchId", "subjectId", "teacherId", "examDate", "startTime", "endTime", "maximumMarks", "passingMarks"] as const;

export type ExaminationHistoricalActivity = {
  publishedQuestionPapers: number;
  answerSheets: number;
  results: number;
};

export function changesCoreExaminationField(input: Record<string, unknown>, current: Record<string, unknown>) {
  return examinationCoreFields.some(field => field in input && String(input[field]) !== String(current[field]));
}

export function assertExaminationHistoricalFieldsEditable(activity: ExaminationHistoricalActivity) {
  if (activity.publishedQuestionPapers + activity.answerSheets + activity.results) {
    throw new AppError(409, "EXAMINATION_ACTIVITY_LOCKED", "Core examination fields cannot change after a paper is published or student activity exists");
  }
}
