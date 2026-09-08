import { AppError } from "./http.js";

export type ParentLeaveStudent = {
  organizationId: string;
  status: string;
  branchId: string;
  batchId: string;
  user: { id: string; name: string; organizationId: string; isActive: boolean };
  branch: { organizationId: string };
  session: { startsAt: Date; endsAt: Date };
};

export function assertParentLeaveStudentAuthorized(student: ParentLeaveStudent | null, organizationId: string) {
  if (!student
    || student.organizationId !== organizationId
    || student.user.organizationId !== organizationId
    || student.branch.organizationId !== organizationId
    || student.status !== "ACTIVE"
    || !student.user.isActive) {
    throw new AppError(403, "STUDENT_NOT_AVAILABLE", "The selected active student is not available to this account");
  }
  return student;
}

export function leaveDecisionRecipient(subjectUserId: string, submittedById: string | null) {
  return submittedById ?? subjectUserId;
}

export function isLegacyParentLeave(role: string, submittedById: string | null) {
  return role === "PARENT" && submittedById === null;
}
