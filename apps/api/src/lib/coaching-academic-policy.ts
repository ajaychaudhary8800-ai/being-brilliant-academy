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
