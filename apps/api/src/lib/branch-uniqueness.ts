import { AppError } from "./http.js";

type PrismaErrorLike = {
  code?: unknown;
  meta?: { target?: unknown } | null;
};

export function isBranchCodeConflict(error: unknown) {
  const candidate = error as PrismaErrorLike | null;
  if (candidate?.code !== "P2002") return false;

  const target = candidate.meta?.target;
  if (Array.isArray(target)) {
    return target.includes("organizationId") && (target.includes("code") || target.includes("branchCode"));
  }

  return typeof target === "string"
    && (target.includes("Branch_organizationId_code_key") || target.includes("Branch_organizationId_branchCode_key"));
}

export function branchCodeConflict() {
  return new AppError(409, "BRANCH_CODE_EXISTS", "Branch code already exists in this organization");
}
