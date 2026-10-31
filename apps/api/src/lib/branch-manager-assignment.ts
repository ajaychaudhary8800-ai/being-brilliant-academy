import { Role } from "@prisma/client";
import { AppError } from "./http.js";

export type ManagerUserCandidate = {
  id: string;
  email: string;
  role: Role;
  isActive: boolean;
  organizationId: string;
};

export type BranchManagerAssignmentInput = {
  organizationId: string;
  requestedEmail: string;
  branch: { id: string; organizationId: string; isActive: boolean } | null;
  currentManagers: ReadonlyArray<ManagerUserCandidate>;
  candidate: ManagerUserCandidate | null;
};

/**
 * Validates a manager for an EXISTING branch without expanding branch-admin
 * privileges. The caller must also require an authenticated SUPER_ADMIN.
 *
 * Existing managers are never silently replaced. Only eligible, active
 * BRANCH_ADMIN accounts belonging to the exact tenant may be reused.
 */
export function validateExistingBranchManagerAssignment(input: BranchManagerAssignmentInput) {
  if (!input.branch || input.branch.organizationId !== input.organizationId)
    throw new AppError(404, "BRANCH_NOT_FOUND", "Branch not found in this organization");
  if (!input.branch.isActive)
    throw new AppError(409, "INACTIVE_BRANCH_MANAGER_PROHIBITED", "Activate the branch before appointing its manager");
  if (input.currentManagers.length > 1)
    throw new AppError(409, "BRANCH_MANAGER_CONFLICT", "This branch has multiple administrator assignments; reconcile before appointing a manager");

  const current = input.currentManagers[0];
  if (current && (current.organizationId !== input.organizationId
    || current.role !== Role.BRANCH_ADMIN || !current.isActive))
    throw new AppError(409, "BRANCH_MANAGER_CONFLICT", "The existing branch manager assignment is invalid");

  if (current) {
    if (current.email !== input.requestedEmail)
      throw new AppError(409, "BRANCH_MANAGER_ALREADY_ASSIGNED", "A different manager is already assigned to this branch");
    return "ALREADY_ASSIGNED" as const;
  }

  if (input.candidate) {
    if (input.candidate.organizationId !== input.organizationId
      || input.candidate.role !== Role.BRANCH_ADMIN)
      throw new AppError(409, "MANAGER_EMAIL_EXISTS", "Manager email belongs to another account");
    if (!input.candidate.isActive)
      throw new AppError(409, "MANAGER_ACCOUNT_INACTIVE", "Manager account is inactive");
    return "ASSIGN_EXISTING" as const;
  }

  return "CREATE_NEW" as const;
}
