import { Role } from "@prisma/client";
import type { AuthRequest } from "../middleware/auth.js";
import { AppError } from "./http.js";
import { prisma } from "./prisma.js";

export type ErpBranchScope = string[] | null;

const denied = () => new AppError(403, "BRANCH_FORBIDDEN", "Branch access denied");

export async function erpBranchScope(req: AuthRequest): Promise<ErpBranchScope> {
  if (req.auth!.role === Role.SUPER_ADMIN) return null;
  if (req.auth!.role !== Role.BRANCH_ADMIN) throw denied();
  const assignments = await prisma.branchUser.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      userId: req.auth!.userId,
      branch: { isActive: true },
    },
    select: { branchId: true },
  });
  return [...new Set(assignments.map(assignment => assignment.branchId))];
}

export function assertErpBranchAccess(scope: ErpBranchScope, branchId: string) {
  if (scope && !scope.includes(branchId)) throw denied();
}

export function assertErpOperationalAccess(scope: ErpBranchScope) {
  if (scope && scope.length === 0) throw denied();
}

export async function assertErpBranchTarget(scope: ErpBranchScope, branchId: string) {
  assertErpBranchAccess(scope, branchId);
  const branch = await prisma.branch.findFirst({ where: { id: branchId, isActive: true }, select: { id: true } });
  if (!branch) throw denied();
}

export function erpBranchWhere(scope: ErpBranchScope) {
  return scope ? { branchId: { in: scope } } : {};
}
