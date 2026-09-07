import { AppError } from "./http.js";

export const parentRelationships = ["Father", "Mother", "Guardian", "Other"] as const;
export type ParentRelationship = typeof parentRelationships[number];

export function isEligibleParentStudent(student: { status: string; user: { isActive: boolean } }) {
  return student.status === "ACTIVE" && student.user.isActive;
}

export function assertEligibleParentStudent(student: { status: string; user: { isActive: boolean } }) {
  if (!isEligibleParentStudent(student)) throw new AppError(422, "INVALID_STUDENT", "Every selected student must be active and eligible");
}

export function assertParentBranchScope(allowedBranchIds: readonly string[] | null, studentBranchIds: readonly string[]) {
  if (allowedBranchIds && studentBranchIds.some(branchId => !allowedBranchIds.includes(branchId))) throw new AppError(403, "BRANCH_FORBIDDEN", "A selected student is outside your assigned branch scope");
}
