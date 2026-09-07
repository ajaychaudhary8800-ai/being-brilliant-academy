import { AttendanceStatus } from "@prisma/client";

export type AttendanceCounts = {
  present: number;
  absent: number;
  late: number;
  fullDayLeave: number;
  halfDayLeave: number;
  shortLeave: number;
  leave: number;
  excused: number;
  total: number;
  percentage: number;
};

export type AttendanceReportPerson = { id: string; name: string; identifier: string | null; branch: string | null; course?: string | null; batch?: string | null };

export type AttendanceReportRecord = { date: Date; status: AttendanceStatus; person: AttendanceReportPerson };

export function emptyAttendanceCounts(): AttendanceCounts {
  return { present: 0, absent: 0, late: 0, fullDayLeave: 0, halfDayLeave: 0, shortLeave: 0, leave: 0, excused: 0, total: 0, percentage: 0 };
}

export function summarizeAttendance(records: readonly { status: AttendanceStatus }[]): AttendanceCounts {
  const counts = emptyAttendanceCounts();
  for (const record of records) {
    counts.total += 1;
    if (record.status === AttendanceStatus.PRESENT) counts.present += 1;
    else if (record.status === AttendanceStatus.ABSENT) counts.absent += 1;
    else if (record.status === AttendanceStatus.LATE) counts.late += 1;
    else if (record.status === AttendanceStatus.FULL_DAY_LEAVE) counts.fullDayLeave += 1;
    else if (record.status === AttendanceStatus.HALF_DAY_LEAVE) counts.halfDayLeave += 1;
    else if (record.status === AttendanceStatus.SHORT_LEAVE) counts.shortLeave += 1;
    else if (record.status === AttendanceStatus.LEAVE) counts.leave += 1;
    else if (record.status === AttendanceStatus.EXCUSED) counts.excused += 1;
  }
  counts.percentage = counts.total ? Math.round(((counts.present + counts.late) / counts.total) * 10000) / 100 : 0;
  return counts;
}

export function groupAttendanceRecords(records: readonly AttendanceReportRecord[]) {
  const grouped = new Map<string, { person: AttendanceReportPerson; counts: AttendanceCounts }>();
  for (const record of records) {
    const current = grouped.get(record.person.id) ?? { person: record.person, counts: emptyAttendanceCounts() };
    const next = summarizeAttendance([{ status: record.status }]);
    for (const key of ["present", "absent", "late", "fullDayLeave", "halfDayLeave", "shortLeave", "leave", "excused", "total"] as const) current.counts[key] += next[key];
    current.counts.percentage = current.counts.total ? Math.round(((current.counts.present + current.counts.late) / current.counts.total) * 10000) / 100 : 0;
    grouped.set(record.person.id, current);
  }
  return [...grouped.values()];
}

export function averageAttendancePercentage(rows: readonly { counts: Pick<AttendanceCounts, "percentage"> }[]) {
  return rows.length ? Math.round(rows.reduce((total, row) => total + row.counts.percentage, 0) / rows.length * 100) / 100 : 0;
}
