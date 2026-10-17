import { AppError } from "./http.js";

export type SchoolDayEntry = {
  branchId: string;
  courseId: string;
  batchId: string;
  academicSession: string;
  day: string;
  periodNumber: number;
  startTime: string;
  endTime: string;
  status: string;
};

function minutes(clock: string): number {
  const [hour, minute] = clock.split(":").map(Number);
  return hour * 60 + minute;
}

/** Verify an atomic class-day operation without touching the database. */
export function validateClassDayEntries<T extends SchoolDayEntry>(entries: T[]): T[] {
  if (entries.length < 1 || entries.length > 50) {
    throw new AppError(422, "INVALID_CLASS_DAY_SIZE", "Select 1 to 50 teaching periods for one class and day");
  }
  const first = entries[0];
  const seen = new Set<number>();
  const ordered = [...entries].sort((a, b) => a.periodNumber - b.periodNumber);
  let previousEnd = -1;
  for (const entry of ordered) {
    if (entry.branchId !== first.branchId || entry.courseId !== first.courseId ||
        entry.batchId !== first.batchId || entry.academicSession !== first.academicSession ||
        entry.day !== first.day) {
      throw new AppError(422, "MIXED_CLASS_DAY", "All periods must belong to the same class, section and weekday");
    }
    if (entry.status !== "ACTIVE") {
      throw new AppError(422, "INVALID_CLASS_DAY_STATUS", "Only active teaching periods may be added to a class day");
    }
    if (seen.has(entry.periodNumber)) {
      throw new AppError(422, "DUPLICATE_CLASS_DAY_PERIOD", "A class day cannot repeat the same period number");
    }
    seen.add(entry.periodNumber);
    const start = minutes(entry.startTime);
    const end = minutes(entry.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < previousEnd) {
      throw new AppError(422, "OVERLAPPING_CLASS_DAY", "Class periods must have valid, non-overlapping times");
    }
    previousEnd = end;
  }
  return ordered;
}
