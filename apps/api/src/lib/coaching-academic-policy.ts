import { AppError } from "./http.js";

/** School sections and general groups keep their original primary-branch restriction. */
export const isCoaching = (groupLabelType: string | null | undefined) => groupLabelType === "BATCH";

export function teacherAssignable(groupLabelType: string | null | undefined, teacher: {
  organizationId: string; branchId: string;
}, branchId: string, organizationId: string) {
  return teacher.organizationId === organizationId && (isCoaching(groupLabelType) || teacher.branchId === branchId);
}

export function assertBatchCoachingGrades(groupLabelType: string | null | undefined, grades?: number[]) {
  if (!isCoaching(groupLabelType)) {
    if (grades?.length) throw new AppError(422, "COACHING_MODE_REQUIRED", "Multi-class batches are available only in coaching mode");
    return;
  }
  if (grades && (new Set(grades).size !== grades.length || grades.some(grade => !Number.isInteger(grade) || grade < 1 || grade > 12))) {
    throw new AppError(422, "INVALID_COACHING_GRADES", "Choose distinct class levels between 1 and 12");
  }
}

/** Apply one-institution authorization to subject allocation reads without
 * reimposing the school-mode home-branch restriction on coaching teachers. */
export function teacherAllocationReadScope(
  groupLabelType: string | null | undefined,
  organizationId: string,
  branchId: string,
) {
  return {
    organizationId,
    ...(!isCoaching(groupLabelType) ? { branchId } : {}),
    user: { isActive: true },
  };
}

/** An empty list preserves the unrestricted behavior of legacy coaching batches. */
export function assertStudentCoachingGrade(groupLabelType: string | null | undefined, allowedGrades: number[] = [], grade: number | null | undefined, required = allowedGrades.length > 0) {
  if (!isCoaching(groupLabelType)) {
    if (grade != null) throw new AppError(422, "COACHING_MODE_REQUIRED", "Class level selection is available only in coaching mode");
    return null;
  }
  if (grade == null) {
    if (required) throw new AppError(422, "COACHING_GRADE_REQUIRED", "Select the student's actual class level");
    return null;
  }
  if (!Number.isInteger(grade) || grade < 1 || grade > 12 || (allowedGrades.length > 0 && !allowedGrades.includes(grade))) {
    throw new AppError(422, "COACHING_GRADE_NOT_ALLOWED", "Student class level is not permitted for this coaching batch");
  }
  return grade;
}

/** LMS branch scope expands only for a coaching teacher's active, same-tenant allocations. */
export function teacherLmsBranchScope(groupLabelType: string | null | undefined, homeBranchId: string, allocatedBranchIds: string[]) {
  return isCoaching(groupLabelType) ? [...new Set([homeBranchId, ...allocatedBranchIds])] : [homeBranchId];
}

/** Preflight leave checks may accept a cross-branch coaching teacher only when
 * the requested batch has an active teacher allocation or timetable. The final
 * attendance handler remains authoritative for enrollment and write access. */
export function teacherAttendanceLeaveTargetAccess(
  groupLabelType: string | null | undefined,
  teacher: { organizationId: string; branchId: string },
  student: { organizationId: string; branchId: string },
  hasActiveBatchAssignment: boolean,
) {
  return teacher.organizationId === student.organizationId &&
    (teacher.branchId === student.branchId || (isCoaching(groupLabelType) && hasActiveBatchAssignment));
}

/**
 * Coaching LMS live classes can use a teacher/course linked to a different
 * home branch only when an ACTIVE, effective, exact batch-subject allocation
 * was resolved in the same institution. The caller must verify allocation
 * status and effective dates before invoking this predicate.
 *
 * School sections and unrelated coaching allocations never bypass the normal
 * course/teacher home-branch checks.
 */
export function coachingLiveClassBranchOverride(
  groupLabelType: string | null | undefined,
  organizationId: string,
  target: {
    branchId?: string | null;
    courseId?: string | null;
    batchId?: string | null;
    subjectId?: string | null;
    teacherId?: string | null;
  },
  allocation: {
    organizationId: string;
    branchId: string;
    courseId: string;
    batchId: string;
    subjectId: string;
    teacherId: string;
  } | null | undefined,
): boolean {
  return isCoaching(groupLabelType)
    && Boolean(organizationId && target.branchId && target.courseId && target.batchId && target.subjectId && target.teacherId)
    && Boolean(allocation)
    && allocation!.organizationId === organizationId
    && allocation!.branchId === target.branchId
    && allocation!.courseId === target.courseId
    && allocation!.batchId === target.batchId
    && allocation!.subjectId === target.subjectId
    && allocation!.teacherId === target.teacherId;
}
