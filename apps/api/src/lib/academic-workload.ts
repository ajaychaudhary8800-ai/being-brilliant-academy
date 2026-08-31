import { LeaveRequestStatus, SubstitutionStatus, TimetableDay, TimetablePeriodType, TimetableStatus } from "@prisma/client";
import { prisma } from "./prisma.js";

const days = [TimetableDay.SUNDAY, TimetableDay.MONDAY, TimetableDay.TUESDAY, TimetableDay.WEDNESDAY, TimetableDay.THURSDAY, TimetableDay.FRIDAY, TimetableDay.SATURDAY];
export function timetableDay(date: Date) { return days[date.getUTCDay()]; }
export function utcDay(value: Date | string) { const date = new Date(value); return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); }
export function weekDates(value: Date) { const date = utcDay(value), monday = new Date(date); monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7)); return Array.from({ length: 7 }, (_, index) => { const next = new Date(monday); next.setUTCDate(monday.getUTCDate() + index); return next; }); }

export type WorkloadSummary = { date: string; day: TimetableDay; availablePeriods: number; regularTeaching: number; substitution: number; otherDuty: number; totalOccupied: number; freePeriods: number; states: Array<{ periodNumber: number; state: "TEACHING" | "FREE" | "BREAK" | "SUBSTITUTION" | "ADMIN_DUTY" | "EXAM_DUTY" | "MEETING" | "COUNSELLING" | "OTHER_DUTY" }> };
export type SubstituteCandidate = { name: string; subjectQualified: boolean; courseFamiliar: boolean; todayLoad: number };

export function rankSubstituteCandidates<T extends SubstituteCandidate>(candidates: T[]) {
  return [...candidates].sort((a, b) => Number(b.subjectQualified) - Number(a.subjectQualified) || Number(b.courseFamiliar) - Number(a.courseFamiliar) || a.todayLoad - b.todayLoad || a.name.localeCompare(b.name));
}

export function summarizeSlots(date: Date, periods: Array<{ periodNumber: number; type: TimetablePeriodType }>, regular: number[], substitutions: number[], duties: Array<{ periodNumber: number; type: WorkloadSummary["states"][number]["state"] }>): WorkloadSummary {
  const teaching = periods.filter(period => period.type === TimetablePeriodType.TEACHING), regularSet = new Set(regular), substitutionSet = new Set(substitutions), duty = new Map(duties.map(row => [row.periodNumber, row.type]));
  const states = periods.map(period => ({ periodNumber: period.periodNumber, state: period.type === TimetablePeriodType.BREAK ? "BREAK" as const : substitutionSet.has(period.periodNumber) ? "SUBSTITUTION" as const : duty.get(period.periodNumber) ?? (regularSet.has(period.periodNumber) ? "TEACHING" as const : "FREE" as const) }));
  const regularTeaching = states.filter(row => row.state === "TEACHING").length, substitution = states.filter(row => row.state === "SUBSTITUTION").length, otherDuty = states.filter(row => !["TEACHING", "FREE", "BREAK", "SUBSTITUTION"].includes(row.state)).length, totalOccupied = regularTeaching + substitution + otherDuty;
  return { date: utcDay(date).toISOString().slice(0, 10), day: timetableDay(date), availablePeriods: teaching.length, regularTeaching, substitution, otherDuty, totalOccupied, freePeriods: Math.max(0, teaching.length - totalOccupied), states };
}

export async function teacherOnApprovedLeave(teacherId: string, date: Date) {
  return Boolean(await prisma.leaveRequest.findFirst({ where: { user: { teacherProfile: { id: teacherId } }, status: LeaveRequestStatus.APPROVED, fromDate: { lte: utcDay(date) }, toDate: { gte: utcDay(date) } }, select: { id: true } }));
}

export async function dailyWorkload(teacherId: string, branchId: string, academicSessionId: string, date: Date): Promise<WorkloadSummary> {
  const day = timetableDay(date), normalized = utcDay(date);
  const [periods, regularRows, substitutions, duties, replacements] = await Promise.all([
    prisma.timetablePeriod.findMany({ where: { branchId, academicSessionId, day, isActive: true }, select: { periodNumber: true, type: true }, orderBy: { periodNumber: "asc" } }),
    prisma.timetable.findMany({ where: { branchId, academicSessionId, teacherId, day, status: TimetableStatus.ACTIVE }, select: { id: true, periodNumber: true } }),
    prisma.teacherSubstitution.findMany({ where: { branchId, academicSessionId, substituteTeacherId: teacherId, date: normalized, status: { in: [SubstitutionStatus.ASSIGNED, SubstitutionStatus.COMPLETED] } }, select: { timetable: { select: { periodNumber: true } } } }),
    prisma.teacherDuty.findMany({ where: { branchId, academicSessionId, teacherId, date: normalized }, select: { periodNumber: true, type: true } }),
    prisma.teacherSubstitution.findMany({ where: { branchId, academicSessionId, originalTeacherId: teacherId, date: normalized, status: { in: [SubstitutionStatus.ASSIGNED, SubstitutionStatus.COMPLETED] } }, select: { timetableId: true } }),
  ]);
  const replaced = new Set(replacements.map(row => row.timetableId));
  return summarizeSlots(normalized, periods, regularRows.filter(row => !replaced.has(row.id)).map(row => row.periodNumber), substitutions.map(row => row.timetable.periodNumber), duties.map(row => ({ periodNumber: row.periodNumber, type: row.type })));
}

export async function weeklyWorkload(teacherId: string, branchId: string, academicSessionId: string, date: Date) {
  const daily = await Promise.all(weekDates(date).map(day => dailyWorkload(teacherId, branchId, academicSessionId, day)));
  return { daily, totals: daily.reduce((total, row) => ({ availablePeriods: total.availablePeriods + row.availablePeriods, regularTeaching: total.regularTeaching + row.regularTeaching, substitution: total.substitution + row.substitution, otherDuty: total.otherDuty + row.otherDuty, totalOccupied: total.totalOccupied + row.totalOccupied, freePeriods: total.freePeriods + row.freePeriods }), { availablePeriods: 0, regularTeaching: 0, substitution: 0, otherDuty: 0, totalOccupied: 0, freePeriods: 0 }) };
}

export async function workloadWarnings(teacherId: string, daily: WorkloadSummary, weeklyOccupied: number) {
  const limits = await prisma.teacherProfile.findUnique({ where: { id: teacherId }, select: { maxPeriodsPerDay: true, maxPeriodsPerWeek: true } });
  return [limits?.maxPeriodsPerDay && daily.totalOccupied > limits.maxPeriodsPerDay ? `Teacher has ${daily.totalOccupied} occupied periods on ${daily.day}; recommended maximum is ${limits.maxPeriodsPerDay}.` : null, limits?.maxPeriodsPerWeek && weeklyOccupied > limits.maxPeriodsPerWeek ? `Teacher has ${weeklyOccupied} occupied periods this week; recommended maximum is ${limits.maxPeriodsPerWeek}.` : null].filter((value): value is string => Boolean(value));
}
