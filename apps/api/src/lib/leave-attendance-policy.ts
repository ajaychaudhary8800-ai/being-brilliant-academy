import { AttendanceStatus } from "@prisma/client";
import { AppError } from "./http.js";

const replaceable = new Set<AttendanceStatus>([AttendanceStatus.ABSENT, AttendanceStatus.LEAVE]);

export function assertLeaveAttendanceCompatible(existing: AttendanceStatus | null, desired: AttendanceStatus, person: string, date: Date) {
  if (existing === null || existing === desired || replaceable.has(existing)) return;
  throw new AppError(409, "ATTENDANCE_CONFLICT", `${person} already has ${existing} attendance on ${date.toISOString().slice(0, 10)}; resolve it before approving leave`);
}
