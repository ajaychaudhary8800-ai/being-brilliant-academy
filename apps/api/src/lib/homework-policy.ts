import { HomeworkStatus, HomeworkSubmissionStatus, Role, StudentStatus } from "@prisma/client";
import { AppError } from "./http.js";

export type HomeworkAttachmentAccess = {
  role: Role;
  requestOrganizationId: string;
  homeworkOrganizationId: string;
  homeworkStatus: HomeworkStatus;
  homeworkBatchId: string;
  homeworkTeacherId: string;
  studentOrganizationId?: string | null;
  studentBatchId?: string | null;
  studentStatus?: StudentStatus | null;
  parentLinked?: boolean;
  parentStudentOrganizationId?: string | null;
  parentStudentBatchId?: string | null;
  parentStudentStatus?: StudentStatus | null;
  teacherId?: string | null;
  branchAllowed?: boolean;
};

export function assertHomeworkAttachmentAccess(access: HomeworkAttachmentAccess) {
  const visible = access.homeworkStatus === HomeworkStatus.PUBLISHED || access.homeworkStatus === HomeworkStatus.CLOSED;
  const studentEligible = access.studentOrganizationId === access.homeworkOrganizationId
    && access.studentBatchId === access.homeworkBatchId
    && access.studentStatus === StudentStatus.ACTIVE;
  const parentStudentEligible = access.parentLinked === true
    && access.parentStudentOrganizationId === access.homeworkOrganizationId
    && access.parentStudentBatchId === access.homeworkBatchId
    && access.parentStudentStatus === StudentStatus.ACTIVE;
  const allowed = access.requestOrganizationId === access.homeworkOrganizationId && (
    access.role === Role.STUDENT && visible && studentEligible
    || access.role === Role.PARENT && visible && parentStudentEligible
    || access.role === Role.TEACHER && access.teacherId === access.homeworkTeacherId
    || access.role === Role.BRANCH_ADMIN && access.branchAllowed === true
    || access.role === Role.SUPER_ADMIN
  );
  if (!allowed) throw new AppError(403, "FORBIDDEN", "Download access denied");
}

export type HomeworkManagerAccess = {
  role: Role;
  requestOrganizationId: string;
  homeworkOrganizationId: string;
  homeworkTeacherId: string;
  authenticatedTeacherId?: string | null;
  branchAllowed?: boolean;
};

export function assertHomeworkManagerAccess(access: HomeworkManagerAccess) {
  const allowed = access.requestOrganizationId === access.homeworkOrganizationId && (
    access.role === Role.SUPER_ADMIN
    || access.role === Role.BRANCH_ADMIN && access.branchAllowed === true
    || access.role === Role.TEACHER && access.authenticatedTeacherId === access.homeworkTeacherId && access.branchAllowed === true
  );
  if (!allowed) throw new AppError(403, "FORBIDDEN", "Homework access denied");
}

export function authenticatedTeacherHomeworkId(authenticatedTeacherId: string, requestedTeacherId?: string | null) {
  if (requestedTeacherId && requestedTeacherId !== authenticatedTeacherId) {
    throw new AppError(403, "FORBIDDEN", "Teachers may only manage their own homework");
  }
  return authenticatedTeacherId;
}

export function assertActiveTeacherHomeworkUser(isActive: boolean) {
  if (!isActive) throw new AppError(403, "INACTIVE_ACCOUNT", "An active Teacher account is required");
}

export type StudentHomeworkSubmissionAccess = {
  role: Role;
  requestOrganizationId: string;
  homeworkOrganizationId: string;
  homeworkStatus: HomeworkStatus;
  homeworkBatchId: string;
  homeworkCourseId: string;
  userIsActive: boolean;
  studentOrganizationId: string;
  studentBatchId: string;
  studentCourseId: string | null;
  studentStatus: StudentStatus;
};

export function assertStudentHomeworkSubmissionAccess(access: StudentHomeworkSubmissionAccess) {
  if (access.role !== Role.STUDENT) {
    throw new AppError(403, "FORBIDDEN", "Only Students may submit Homework");
  }
  if (!access.userIsActive) {
    throw new AppError(403, "INACTIVE_ACCOUNT", "An active Student account is required");
  }
  const eligible = access.studentStatus === StudentStatus.ACTIVE
    && access.requestOrganizationId === access.homeworkOrganizationId
    && access.studentOrganizationId === access.homeworkOrganizationId
    && access.studentBatchId === access.homeworkBatchId
    && access.studentCourseId === access.homeworkCourseId;
  if (!eligible) {
    throw new AppError(403, "STUDENT_NOT_ELIGIBLE", "Homework is not assigned to this Student");
  }
  if (access.homeworkStatus !== HomeworkStatus.PUBLISHED) {
    throw new AppError(409, "HOMEWORK_NOT_OPEN", "Homework is not open for submission");
  }
}

export function assertStudentHomeworkIdentityNotSupplied(requestedStudentId: unknown) {
  if (requestedStudentId !== undefined) {
    throw new AppError(422, "STUDENT_ID_NOT_ALLOWED", "Student identity is derived from the authenticated account");
  }
}

export function assertHomeworkSubmissionContent(answerText: string | null | undefined, hasAttachment: boolean) {
  if (!answerText?.trim() && !hasAttachment) {
    throw new AppError(422, "SUBMISSION_CONTENT_REQUIRED", "Add an answer or an attachment before submitting Homework");
  }
}

export function homeworkSubmissionStatusAt(dueDate: Date, submittedAt: Date) {
  return submittedAt > dueDate ? HomeworkSubmissionStatus.LATE : HomeworkSubmissionStatus.SUBMITTED;
}

export type TeacherHomeworkAllocationContext = {
  branchId: string;
  courseId: string;
  batchId: string;
  teacherId: string;
  academicSessionId: string;
  subjectId: string;
};

export function currentTeacherHomeworkAllocationContext(context: TeacherHomeworkAllocationContext, now = new Date()) {
  return { ...context, effectiveAt: now };
}

export function teacherHomeworkCreateStatus(requestedStatus?: HomeworkStatus) {
  if (requestedStatus !== undefined && requestedStatus !== HomeworkStatus.DRAFT) {
    throw new AppError(409, "TEACHER_HOMEWORK_MUST_START_DRAFT", "Teacher Homework must be created as draft before publishing");
  }
  return HomeworkStatus.DRAFT;
}

export function assertTeacherHomeworkEditable(status: HomeworkStatus) {
  if (status === HomeworkStatus.CLOSED || status === HomeworkStatus.ARCHIVED) {
    throw new AppError(409, "HOMEWORK_STATUS_LOCKED", "Closed or archived Homework cannot be edited by a Teacher");
  }
}

export function assertTeacherHomeworkTransition(currentStatus: HomeworkStatus, nextStatus: HomeworkStatus) {
  const allowed = currentStatus === HomeworkStatus.DRAFT && nextStatus === HomeworkStatus.PUBLISHED
    || currentStatus === HomeworkStatus.PUBLISHED && nextStatus === HomeworkStatus.CLOSED;
  if (!allowed) throw new AppError(409, "INVALID_HOMEWORK_STATUS_TRANSITION", "This Homework status transition is not allowed for a Teacher");
}

export function assertTeacherHomeworkEvaluationOpen(status: HomeworkStatus) {
  if (status !== HomeworkStatus.PUBLISHED && status !== HomeworkStatus.CLOSED) {
    throw new AppError(409, "HOMEWORK_EVALUATION_CLOSED", "Submissions cannot be evaluated for this Homework status");
  }
}

export const evaluableHomeworkSubmissionStatuses: HomeworkSubmissionStatus[] = [
  HomeworkSubmissionStatus.SUBMITTED,
  HomeworkSubmissionStatus.LATE,
];

export function assertHomeworkSubmissionEvaluable(status: HomeworkSubmissionStatus) {
  if (!evaluableHomeworkSubmissionStatuses.includes(status)) {
    throw new AppError(409, "SUBMISSION_ALREADY_EVALUATED", "A finalized Homework submission cannot be evaluated again");
  }
}

export function assertHomeworkSubmissionEvaluated(count: number) {
  if (count !== 1) {
    throw new AppError(409, "SUBMISSION_ALREADY_EVALUATED", "A finalized Homework submission cannot be evaluated again");
  }
}

export const replaceableHomeworkSubmissionStatuses: HomeworkSubmissionStatus[] = [
  HomeworkSubmissionStatus.SUBMITTED,
  HomeworkSubmissionStatus.LATE,
];

export function assertHomeworkSubmissionReplaceable(status: HomeworkSubmissionStatus) {
  if (!replaceableHomeworkSubmissionStatuses.includes(status)) {
    throw new AppError(409, "SUBMISSION_REVIEW_STARTED", "A reviewed submission cannot be replaced");
  }
}

export function assertHomeworkSubmissionReplaced(count: number) {
  if (count !== 1) {
    throw new AppError(409, "SUBMISSION_REVIEW_STARTED", "A reviewed submission cannot be replaced");
  }
}
