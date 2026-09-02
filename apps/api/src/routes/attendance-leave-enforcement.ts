import { AttendanceStatus, LeaveRequestStatus, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/http.js";
import { assertApprovedLeaveAttendance, attendanceStatusForLeave } from "../lib/leave-attendance-policy.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);
const id = z.string().cuid();
const attendanceManagers: Role[] = [Role.SUPER_ADMIN, Role.BRANCH_ADMIN, Role.TEACHER];
const day = (value: Date) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
const overrideInput = z.object({ overrideApprovedLeave: z.boolean().optional().default(false), overrideReason: z.string().trim().max(1000).nullable().optional() }).passthrough();
type Context = { kind: "student" | "teacher"; personId: string; date: Date; status: AttendanceStatus; entityId?: string };

async function approvedLeave(context: Context) {
  return prisma.leaveRequest.findFirst({
    where: {
      status: LeaveRequestStatus.APPROVED,
      fromDate: { lte: day(context.date) },
      toDate: { gte: day(context.date) },
      ...(context.kind === "student" ? { userId: context.personId } : { user: { teacherProfile: { id: context.personId } } }),
    },
    select: { id: true, leaveType: true },
  });
}

async function assertTargetScope(req: AuthRequest, context: Context) {
  if (req.auth!.role === Role.SUPER_ADMIN) return;
  const target = context.kind === "student"
    ? await prisma.studentProfile.findUnique({ where: { userId: context.personId }, select: { branchId: true } })
    : await prisma.teacherProfile.findUnique({ where: { id: context.personId }, select: { branchId: true } });
  if (!target) return;
  if (req.auth!.role === Role.BRANCH_ADMIN) {
    if (!await prisma.branchUser.findFirst({ where: { userId: req.auth!.userId, branchId: target.branchId }, select: { branchId: true } })) throw new AppError(403, "BRANCH_FORBIDDEN", "Branch access denied");
    return;
  }
  const teacher = await prisma.teacherProfile.findUnique({ where: { userId: req.auth!.userId }, select: { branchId: true } });
  if (!teacher || teacher.branchId !== target.branchId) throw new AppError(403, "BRANCH_FORBIDDEN", "Branch access denied");
}

async function contexts(req: AuthRequest): Promise<Context[]> {
  if (req.method === "POST" && req.path === "/bulk") {
    const body = z.object({ date: z.coerce.date(), records: z.array(z.object({ studentId: id, status: z.nativeEnum(AttendanceStatus) })) }).parse(req.body);
    return body.records.map(record => ({ kind: "student", personId: record.studentId, date: body.date, status: record.status }));
  }
  if (req.method === "POST" && req.path === "/") {
    const body = z.object({ studentId: id, date: z.coerce.date(), status: z.nativeEnum(AttendanceStatus) }).parse(req.body);
    return [{ kind: "student", personId: body.studentId, date: body.date, status: body.status }];
  }
  if (req.method === "POST" && req.path === "/teachers/records") {
    const body = z.object({ teacherId: id, date: z.coerce.date(), status: z.nativeEnum(AttendanceStatus) }).parse(req.body);
    return [{ kind: "teacher", personId: body.teacherId, date: body.date, status: body.status }];
  }
  const teacherMatch = req.path.match(/^\/teachers\/records\/([^/]+)$/);
  if (teacherMatch && (req.method === "PATCH" || req.method === "DELETE")) {
    const old = await prisma.teacherAttendance.findUnique({ where: { id: id.parse(teacherMatch[1]) }, select: { id: true, teacherId: true, date: true, status: true } });
    if (!old) return [];
    const body = req.method === "PATCH" ? z.object({ teacherId: id.optional(), date: z.coerce.date().optional(), status: z.nativeEnum(AttendanceStatus).optional() }).passthrough().parse(req.body) : {};
    const updated = { kind: "teacher" as const, entityId: old.id, personId: body.teacherId ?? old.teacherId, date: body.date ?? old.date, status: req.method === "DELETE" ? AttendanceStatus.ABSENT : body.status ?? old.status };
    if (req.method === "PATCH" && (updated.personId !== old.teacherId || day(updated.date).getTime() !== day(old.date).getTime())) return [{ kind: "teacher", entityId: old.id, personId: old.teacherId, date: old.date, status: AttendanceStatus.ABSENT }, updated];
    return [updated];
  }
  const studentMatch = req.path.match(/^\/([^/]+)$/);
  if (studentMatch && (req.method === "PATCH" || req.method === "DELETE")) {
    const old = await prisma.attendance.findUnique({ where: { id: id.parse(studentMatch[1]) }, select: { id: true, studentId: true, date: true, status: true } });
    if (!old) return [];
    const body = req.method === "PATCH" ? z.object({ studentId: id.optional(), date: z.coerce.date().optional(), status: z.nativeEnum(AttendanceStatus).optional() }).passthrough().parse(req.body) : {};
    const updated = { kind: "student" as const, entityId: old.id, personId: body.studentId ?? old.studentId, date: body.date ?? old.date, status: req.method === "DELETE" ? AttendanceStatus.ABSENT : body.status ?? old.status };
    if (req.method === "PATCH" && (updated.personId !== old.studentId || day(updated.date).getTime() !== day(old.date).getTime())) return [{ kind: "student", entityId: old.id, personId: old.studentId, date: old.date, status: AttendanceStatus.ABSENT }, updated];
    return [updated];
  }
  return [];
}

router.use(async (req: AuthRequest, res, next) => {
  if (!["POST", "PATCH", "DELETE"].includes(req.method)) return next();
  if (!attendanceManagers.includes(req.auth!.role)) return next();
  if (req.path.startsWith("/teachers/") && req.auth!.role === Role.TEACHER) return next();
  const targets = await contexts(req);
  if (!targets.length) return next();
  const override = overrideInput.parse({ ...req.query, ...req.body });
  const applied: Array<{ leaveRequestId: string; kind: string; personId: string; date: string; requestedStatus: AttendanceStatus }> = [];
  for (const target of targets) {
    await assertTargetScope(req, target);
    const leave = await approvedLeave(target);
    if (!leave) continue;
    const approvedStatus = attendanceStatusForLeave(leave.leaveType);
    if (assertApprovedLeaveAttendance(approvedStatus, target.status, req.auth!.role, override.overrideApprovedLeave, override.overrideReason)) {
      applied.push({ leaveRequestId: leave.id, kind: target.kind, personId: target.personId, date: day(target.date).toISOString().slice(0, 10), requestedStatus: target.status });
    }
  }
  if (applied.length) res.once("finish", () => {
    if (res.statusCode < 400) void prisma.auditLog.create({ data: { organizationId: req.auth!.organizationId, actorId: req.auth!.userId, action: "ATTENDANCE_LEAVE_OVERRIDE", entity: "Attendance", metadata: { reason: override.overrideReason, records: applied } } }).catch(error => console.error("Attendance leave override audit failed", error));
  });
  next();
});

export default router;
