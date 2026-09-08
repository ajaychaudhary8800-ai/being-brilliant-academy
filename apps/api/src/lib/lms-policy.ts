import { Role } from "@prisma/client";
import { AppError } from "./http.js";

export type LmsActor = {
  role: Role;
  branchIds: string[];
  teacherProfileId?: string;
  studentBatchId?: string;
  studentActive?: boolean;
};

export type LmsTarget = {
  branchId: string | null;
  teacherId: string | null;
  batchId: string | null;
  status: string;
};

const denied = () => new AppError(403, "LMS_FORBIDDEN", "Learning content is not available to this account");

export function assertLmsManagementAccess(actor: LmsActor, target: Pick<LmsTarget, "branchId" | "teacherId">) {
  if (actor.role === Role.SUPER_ADMIN) return;
  if (actor.role === Role.BRANCH_ADMIN && target.branchId && actor.branchIds.includes(target.branchId)) return;
  if (actor.role === Role.TEACHER && target.branchId && actor.teacherProfileId === target.teacherId && actor.branchIds.includes(target.branchId)) return;
  throw denied();
}

export function assertLmsContentAccess(actor: LmsActor, target: LmsTarget) {
  if (actor.role === Role.STUDENT) {
    if (actor.studentActive && actor.studentBatchId === target.batchId && target.status === "PUBLISHED") return;
    throw denied();
  }
  assertLmsManagementAccess(actor, target);
}
