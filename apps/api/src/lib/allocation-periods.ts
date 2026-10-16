import { AppError } from "./http.js";

export type AllocationCoordinate = { courseId: string; batchId: string; subjectId: string };
export type AllocationPeriodOverride = AllocationCoordinate & { weeklyPeriods: number };

export function allocationPeriodKey(row: AllocationCoordinate) {
  return `${row.courseId}:${row.batchId}:${row.subjectId}`;
}

/**
 * An allocation is one teacher + course + section/batch + subject.
 * Preserve the legacy common weeklyPeriods value when no override is sent.
 * Reject unselected and duplicate overrides rather than silently dropping them.
 */
export function applyAllocationPeriods<T extends AllocationCoordinate>(
  selections: T[],
  weeklyPeriods: number,
  periodOverrides: AllocationPeriodOverride[] = [],
): Array<T & { weeklyPeriods: number }> {
  const keys = new Set(selections.map(allocationPeriodKey));
  const overrides = new Map<string, number>();
  for (const override of periodOverrides) {
    const key = allocationPeriodKey(override);
    if (!keys.has(key)) {
      throw new AppError(422, "INVALID_ALLOCATION_PERIOD_OVERRIDE", "Weekly periods can only be specified for selected class, section and subject combinations");
    }
    if (overrides.has(key)) {
      throw new AppError(422, "DUPLICATE_ALLOCATION_PERIOD_OVERRIDE", "Each class, section and subject can have only one weekly-period value");
    }
    if (!Number.isInteger(override.weeklyPeriods) || override.weeklyPeriods < 1 || override.weeklyPeriods > 100) {
      throw new AppError(422, "INVALID_WEEKLY_PERIODS", "Weekly periods must be a whole number between 1 and 100");
    }
    overrides.set(key, override.weeklyPeriods);
  }
  return selections.map(row => ({ ...row, weeklyPeriods: overrides.get(allocationPeriodKey(row)) ?? weeklyPeriods }));
}
