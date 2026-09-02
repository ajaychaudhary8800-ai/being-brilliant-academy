import { AttendanceStatus, HalfDaySession, LeaveType, Role } from "@prisma/client";
import { AppError } from "./http.js";

const replaceable = new Set<AttendanceStatus>([AttendanceStatus.ABSENT, AttendanceStatus.LEAVE]);
export const leaveAttendanceStatuses = new Set<AttendanceStatus>([AttendanceStatus.FULL_DAY_LEAVE, AttendanceStatus.HALF_DAY_LEAVE, AttendanceStatus.SHORT_LEAVE]);

export function attendanceStatusForLeave(leaveType: LeaveType) {
  return leaveType === LeaveType.FULL_DAY ? AttendanceStatus.FULL_DAY_LEAVE : leaveType === LeaveType.HALF_DAY ? AttendanceStatus.HALF_DAY_LEAVE : AttendanceStatus.SHORT_LEAVE;
}

export function validateLeaveDates(fromDate: Date, toDate: Date, leaveType: LeaveType, halfDaySession?: HalfDaySession | null) {
  if (toDate < fromDate) throw new AppError(422, "INVALID_DATES", "End date must be on or after start date");
  const sameDay = fromDate.getTime() === toDate.getTime();
  if (leaveType === LeaveType.HALF_DAY && (!halfDaySession || !sameDay)) throw new AppError(422, "INVALID_HALF_DAY", "Half-day leave requires one date and a half-day session");
  if (leaveType === LeaveType.SHORT_LEAVE && !sameDay) throw new AppError(422, "INVALID_SHORT_LEAVE", "Short leave must use one date");
  if (leaveType !== LeaveType.HALF_DAY && halfDaySession) throw new AppError(422, "INVALID_HALF_DAY_SESSION", "A half-day session is only valid for half-day leave");
  const days = Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
  if (days > 366) throw new AppError(422, "LEAVE_RANGE_TOO_LONG", "A leave request cannot exceed 366 days");
}

export function assertLeaveAttendanceCompatible(existing: AttendanceStatus | null, desired: AttendanceStatus, person: string, date: Date) {
  if (existing === null || existing === desired || replaceable.has(existing)) return;
  throw new AppError(409, "ATTENDANCE_CONFLICT", `${person} already has ${existing} attendance on ${date.toISOString().slice(0, 10)}; resolve it before approving leave`);
}

export function assertApprovedLeaveAttendance(approved: AttendanceStatus | null, requested: AttendanceStatus, role: Role, override: boolean, reason?: string | null) {
  if (!approved || approved === requested) return false;
  if (!override) throw new AppError(409, "APPROVED_LEAVE_CONFLICT", `Attendance must remain ${approved} while approved leave exists; use an authorized override to resolve the conflict`);
  if (role !== Role.SUPER_ADMIN && role !== Role.BRANCH_ADMIN) throw new AppError(403, "LEAVE_OVERRIDE_FORBIDDEN", "Only an administrator may override approved leave attendance");
  if (!reason?.trim() || reason.trim().length < 3) throw new AppError(422, "LEAVE_OVERRIDE_REASON_REQUIRED", "An override reason of at least 3 characters is required");
  return true;
}
