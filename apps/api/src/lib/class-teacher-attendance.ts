/** School section daily attendance is reserved for the assigned Class Teacher. */
export function teacherCanMarkDailyAttendance(
  groupLabelType: string,
  classTeacherId: string | null,
  actingTeacherId: string | null,
  hasSubjectOrTimetableAssignment: boolean,
): boolean {
  if (groupLabelType === "SECTION") return Boolean(actingTeacherId && classTeacherId === actingTeacherId);
  return hasSubjectOrTimetableAssignment;
}
