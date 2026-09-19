import { LmsContentStatus, Role } from "@prisma/client";
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


export function lmsLessonCreateStatus(requested?: LmsContentStatus) {
  if (requested !== undefined && requested !== LmsContentStatus.DRAFT) {
    throw new AppError(422, "LESSON_CREATE_STATUS_INVALID", "New lessons must be created as draft");
  }
  return LmsContentStatus.DRAFT;
}

export function assertLmsLessonTransition(current: LmsContentStatus, next: LmsContentStatus) {
  const allowed = current === LmsContentStatus.DRAFT && (next === LmsContentStatus.PUBLISHED || next === LmsContentStatus.ARCHIVED)
    || current === LmsContentStatus.PUBLISHED && next === LmsContentStatus.ARCHIVED;
  if (!allowed) {
    throw new AppError(409, "INVALID_LESSON_STATUS_TRANSITION", `Lesson status cannot change from ${current} to ${next}`);
  }
}

export function assertLmsLessonEditable(status: LmsContentStatus) {
  if (status === LmsContentStatus.ARCHIVED) {
    throw new AppError(409, "LESSON_ARCHIVED", "Archived lessons cannot be edited");
  }
}

export function assertLmsLessonStructuralEditAllowed(hasProgress: boolean, structuralChanged: boolean) {
  if (hasProgress && structuralChanged) {
    throw new AppError(409, "LESSON_PROGRESS_LOCKED", "Lesson academic context and duration cannot change after student progress exists");
  }
}

export function nextLmsProgress(
  current: { watchedSeconds: number; lastPositionSeconds: number; completed: boolean; completedAt: Date | null } | null,
  input: { lastPositionSeconds: number; timeSpentSeconds: number },
  durationSeconds: number,
  now = new Date(),
) {
  const position = Math.min(durationSeconds, Math.max(0, input.lastPositionSeconds));
  const previousWatched = current?.watchedSeconds ?? 0;
  const previousPosition = current?.lastPositionSeconds ?? 0;
  const watchedSeconds = Math.max(previousWatched, position);
  const watchPercentage = durationSeconds ? Math.min(100, Math.round(watchedSeconds / durationSeconds * 100)) : 0;
  const completed = Boolean(current?.completed) || watchPercentage >= 90;
  const completedAt = current?.completedAt ?? (completed ? now : null);
  const creditedTimeSeconds = Math.min(input.timeSpentSeconds, Math.max(0, position - previousPosition));
  return { watchedSeconds, watchPercentage, lastPositionSeconds: Math.max(previousPosition, position), completed, completedAt, creditedTimeSeconds };
}
