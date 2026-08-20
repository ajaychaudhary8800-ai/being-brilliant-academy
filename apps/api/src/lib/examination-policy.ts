import { ExaminationResultStatus, ExaminationStatus } from "@prisma/client";
import { AppError } from "./http.js";

export function assertEvaluationOpen(finalizedAt: Date | null) {
  if (finalizedAt) throw new AppError(409, "EVALUATION_FINALIZED", "A finalized evaluation cannot be modified; an explicit reopen workflow is required");
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
