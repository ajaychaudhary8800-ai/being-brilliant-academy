import { AppError } from "./http.js";

export type WeeklyTimetableEntry = {
  branchId: string; courseId: string; batchId: string;
  subjectId: string; teacherId: string; classroomId: string;
  academicSession: string; day: string; periodNumber: number;
  startTime: string; endTime: string;
};

/** A weekly schedule represents the same assignment on distinct weekdays. */
export function validateWeeklyTimetableEntries<T extends WeeklyTimetableEntry>(entries: T[]): T[] {
  if (!entries.length || entries.length > 7) {
    throw new AppError(422, "INVALID_WEEKLY_TIMETABLE_SIZE", "Select between one and seven weekdays");
  }
  const first = entries[0];
  const unique = new Set<string>();
  for (const row of entries) {
    if (unique.has(row.day)) {
      throw new AppError(422, "DUPLICATE_TIMETABLE_DAY", "Select each weekday only once");
    }
    unique.add(row.day);
    if (["branchId", "courseId", "batchId", "subjectId", "teacherId", "classroomId", "academicSession"].some(
      key => row[key as keyof WeeklyTimetableEntry] !== first[key as keyof WeeklyTimetableEntry],
    )) {
      throw new AppError(422, "MIXED_WEEKLY_TIMETABLE_ASSIGNMENT", "A weekly schedule must use one teacher, subject, section and classroom");
    }
  }
  return entries;
}
