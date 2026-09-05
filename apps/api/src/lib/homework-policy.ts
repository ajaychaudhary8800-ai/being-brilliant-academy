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
