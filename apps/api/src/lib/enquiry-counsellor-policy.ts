import { Role } from "@prisma/client";
import { AppError } from "./http.js";

export type EnquiryCounsellorCandidate = {
  role: Role;
  isActive: boolean;
  branchIds: string[];
};

export function assertEnquiryCounsellorEligible(
  counsellor: EnquiryCounsellorCandidate | null,
  branchId: string,
) {
  if (!counsellor || !counsellor.isActive || ![Role.SUPER_ADMIN, Role.BRANCH_ADMIN].includes(counsellor.role)) {
    throw new AppError(422, "INVALID_COUNSELLOR", "Select an active admin counsellor");
  }
  if (counsellor.role === Role.BRANCH_ADMIN && !counsellor.branchIds.includes(branchId)) {
    throw new AppError(422, "COUNSELLOR_BRANCH_MISMATCH", "The selected counsellor is not assigned to this branch");
  }
}
