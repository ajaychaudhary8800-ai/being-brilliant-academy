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
  courseId?: string | null;
  teacherId: string | null;
  batchId: string | null;
  subjectId?: string | null;
  status: string;
};

export type LmsModuleCourse = {
  branchId: string | null;
};

const denied = () => new AppError(403, "LMS_FORBIDDEN", "Learning content is not available to this account");

export function assertLmsManagementAccess(actor: LmsActor, target: Pick<LmsTarget, "branchId" | "teacherId">) {
  if (actor.role === Role.SUPER_ADMIN) return;
  if (actor.role === Role.BRANCH_ADMIN && target.branchId && actor.branchIds.includes(target.branchId)) return;
  if (actor.role === Role.TEACHER && target.branchId && actor.teacherProfileId === target.teacherId && actor.branchIds.includes(target.branchId)) return;
  throw denied();
}

export function assertLmsModuleManagementAccess(actor: LmsActor, course: LmsModuleCourse) {
  if (actor.role === Role.SUPER_ADMIN) return;
  if (actor.role === Role.BRANCH_ADMIN && actor.branchIds.length > 0 && (course.branchId === null || actor.branchIds.includes(course.branchId))) return;
  throw denied();
}

export function lmsModuleCourseWhere(actor: LmsActor) {
  if (actor.role === Role.SUPER_ADMIN) return {};
  if (actor.branchIds.length === 0) return { course: { is: { branchId: { in: [] as string[] } } } };
  return { course: { is: { OR: [{ branchId: { in: actor.branchIds } }, { branchId: null }] } } };
}

export function lmsLessonBranchFilter(actor: LmsActor, requestedBranchId?: string) {
  if (actor.role === Role.SUPER_ADMIN) return requestedBranchId;
  if (requestedBranchId && !actor.branchIds.includes(requestedBranchId)) throw denied();
  return requestedBranchId ?? { in: actor.branchIds };
}

export function assertLmsContentAccess(actor: LmsActor, target: LmsTarget) {
  if (actor.role === Role.STUDENT) {
    if (actor.studentActive && actor.studentBatchId === target.batchId && target.status === "PUBLISHED") return;
    throw denied();
  }
  assertLmsManagementAccess(actor, target);
}
