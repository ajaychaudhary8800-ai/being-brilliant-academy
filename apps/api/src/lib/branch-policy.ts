import { Role } from "@prisma/client";
import { AppError } from "./http.js";

export function requireRequestedBranch(role: Role, assignedBranchIds: readonly string[], requestedBranchId?: string) {
  const branchScoped = role === Role.BRANCH_ADMIN || role === Role.ACCOUNTANT;
  if (branchScoped && requestedBranchId && !assignedBranchIds.includes(requestedBranchId)) {
    throw new AppError(403, "BRANCH_FORBIDDEN", "Branch access denied");
  }
  return requestedBranchId
    ? { branchId: requestedBranchId }
    : branchScoped
      ? { branchId: { in: [...assignedBranchIds] } }
      : {};
}

export function assertClassroomBranchChange(currentBranchId: string, nextBranchId: string, timetableReferences: number) {
  if (currentBranchId !== nextBranchId && timetableReferences > 0) throw new AppError(409, "CLASSROOM_BRANCH_LOCKED", "A classroom referenced by timetable periods cannot be moved to another branch");
}
