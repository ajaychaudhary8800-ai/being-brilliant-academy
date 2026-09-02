import { AttendanceStatus, HalfDaySession, LeaveRequestStatus, LeaveType, Prisma, Role, StudentStatus } from "@prisma/client";
import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import { AppError } from "../lib/http.js";
import { assertLeaveAttendanceCompatible, attendanceStatusForLeave, validateLeaveDates } from "../lib/leave-attendance-policy.js";
import { prisma } from "../lib/prisma.js";
import { assertDocumentFileExtension, decodeVerifiedUpload } from "../lib/secure-upload.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);
const id = z.string().cuid();
const applicantRoles: Role[] = [Role.STUDENT, Role.TEACHER];
const administratorRoles: Role[] = [Role.SUPER_ADMIN, Role.BRANCH_ADMIN];
const attachmentTypes = ["application/pdf", "image/jpeg", "image/png"] as const;
const requestInput = z.object({
  fromDate: z.coerce.date(),
  toDate: z.coerce.date(),
  reason: z.string().trim().min(3).max(2000),
  leaveType: z.nativeEnum(LeaveType).default(LeaveType.FULL_DAY),
  halfDaySession: z.nativeEnum(HalfDaySession).nullable().optional(),
  attachment: z.object({ name: z.string().trim().min(1).max(180), mimeType: z.enum(attachmentTypes), base64: z.string().min(1) }).nullable().optional(),
});
const day = (value: Date) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
const leaveSelect = {
  id: true, fromDate: true, toDate: true, reason: true, leaveType: true, halfDaySession: true, status: true, remarks: true,
  attachmentName: true, attachmentMime: true, approvedAt: true, createdAt: true, updatedAt: true,
  user: { select: { id: true, name: true, role: true } }, branch: { select: { id: true, branchName: true } }, approvedBy: { select: { id: true, name: true } },
} as const;

async function applicant(req: AuthRequest) {
  if (req.auth!.role === Role.STUDENT) {
    const profile = await prisma.studentProfile.findUnique({ where: { userId: req.auth!.userId }, select: { branchId: true, batchId: true, status: true, user: { select: { name: true, isActive: true } }, session: { select: { startsAt: true, endsAt: true } } } });
    if (!profile || !profile.user.isActive || profile.status !== StudentStatus.ACTIVE) throw new AppError(403, "INACTIVE_APPLICANT", "An active student profile is required");
    return { branchId: profile.branchId, batchId: profile.batchId, name: profile.user.name, session: profile.session };
  }
  if (req.auth!.role === Role.TEACHER) {
    const profile = await prisma.teacherProfile.findUnique({ where: { userId: req.auth!.userId }, select: { branchId: true, user: { select: { name: true, isActive: true } } } });
    if (!profile || !profile.user.isActive) throw new AppError(403, "INACTIVE_APPLICANT", "An active teacher profile is required");
    return { branchId: profile.branchId, name: profile.user.name, session: null };
  }
  throw new AppError(403, "APPLICANT_ROLE_REQUIRED", "Student or teacher access is required");
}

async function branchAccess(req: AuthRequest, branchId: string) {
  if (req.auth!.role !== Role.BRANCH_ADMIN) return;
  if (!await prisma.branchUser.findFirst({ where: { userId: req.auth!.userId, branchId }, select: { branchId: true } })) throw new AppError(403, "BRANCH_FORBIDDEN", "Branch access denied");
}

function storedAttachment(value: z.infer<typeof requestInput>["attachment"]) {
  if (!value) return {};
  assertDocumentFileExtension(value.name, value.mimeType);
  const data = decodeVerifiedUpload(value.base64, value.mimeType, 5 * 1024 * 1024);
  return { attachmentName: value.name, attachmentMime: value.mimeType, attachmentData: data };
}

async function notifyReviewers(tx: Prisma.TransactionClient, organizationId: string, branchId: string, leaveId: string, applicantName: string, role: Role) {
  const reviewers = await tx.user.findMany({ where: { OR: [{ role: Role.SUPER_ADMIN }, { role: Role.BRANCH_ADMIN, branchAssignments: { some: { branchId } } }] }, select: { id: true } });
  if (reviewers.length) await tx.notification.createMany({ data: reviewers.map(user => ({ organizationId, userId: user.id, title: "New leave request", body: `${applicantName} (${role}) submitted a leave request.`, category: "LEAVE", sourceModule: "LEAVE_MANAGEMENT", sourceEntityId: leaveId, actionUrl: "/admin/leaves" })) });
}

router.get("/portal/leaves", async (req: AuthRequest, res, next: NextFunction) => {
  if (req.auth!.role === Role.PARENT) return next();
  if (!applicantRoles.includes(req.auth!.role)) throw new AppError(403, "APPLICANT_ROLE_REQUIRED", "Student or teacher access is required");
  const data = await prisma.leaveRequest.findMany({ where: { userId: req.auth!.userId }, select: leaveSelect, orderBy: { createdAt: "desc" }, take: 200 });
  res.json({ data });
});

router.post("/portal/leaves", async (req: AuthRequest, res, next: NextFunction) => {
  if (req.auth!.role === Role.PARENT) return next();
  if (!applicantRoles.includes(req.auth!.role)) throw new AppError(403, "APPLICANT_ROLE_REQUIRED", "Student or teacher access is required");
  const data = requestInput.parse(req.body), fromDate = day(data.fromDate), toDate = day(data.toDate);
  validateLeaveDates(fromDate, toDate, data.leaveType, data.halfDaySession);
  const profile = await applicant(req);
  if (profile.session && (fromDate < day(profile.session.startsAt) || toDate > day(profile.session.endsAt))) throw new AppError(422, "OUTSIDE_ACADEMIC_SESSION", "Student leave dates must be within the enrolled academic session");
  const { attachment: file, ...rest } = data;
  try {
    const leave = await prisma.$transaction(async tx => {
      const overlap = await tx.leaveRequest.findFirst({ where: { userId: req.auth!.userId, status: { in: [LeaveRequestStatus.PENDING, LeaveRequestStatus.APPROVED] }, fromDate: { lte: toDate }, toDate: { gte: fromDate } }, select: { id: true } });
      if (overlap) throw new AppError(409, "OVERLAPPING_LEAVE", "An active leave request overlaps these dates");
      const created = await tx.leaveRequest.create({ data: { ...rest, fromDate, toDate, userId: req.auth!.userId, branchId: profile.branchId, ...storedAttachment(file) }, select: leaveSelect });
      await tx.auditLog.create({ data: { organizationId: req.auth!.organizationId, actorId: req.auth!.userId, action: "SUBMIT", entity: "LeaveRequest", entityId: created.id, metadata: { leaveType: created.leaveType, fromDate: created.fromDate, toDate: created.toDate } } });
      await notifyReviewers(tx, req.auth!.organizationId, profile.branchId, created.id, profile.name, req.auth!.role);
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.status(201).json({ data: leave });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) throw new AppError(409, "OVERLAPPING_LEAVE", "A leave request already exists or overlaps these dates; refresh and try again");
    throw error;
  }
});

router.delete("/portal/leaves/:leaveId", async (req: AuthRequest, res) => {
  const leaveId = id.parse(req.params.leaveId);
  const data = await prisma.$transaction(async tx => {
    const changed = await tx.leaveRequest.updateMany({ where: { id: leaveId, userId: req.auth!.userId, status: LeaveRequestStatus.PENDING }, data: { status: LeaveRequestStatus.CANCELLED } });
    if (changed.count !== 1) {
      const exists = await tx.leaveRequest.findFirst({ where: { id: leaveId, userId: req.auth!.userId }, select: { id: true } });
      if (!exists) throw new AppError(404, "LEAVE_NOT_FOUND", "Leave request not found");
      throw new AppError(409, "LEAVE_LOCKED", "Only pending leave requests can be cancelled");
    }
    await tx.auditLog.create({ data: { organizationId: req.auth!.organizationId, actorId: req.auth!.userId, action: "CANCEL", entity: "LeaveRequest", entityId: leaveId } });
    return tx.leaveRequest.findUniqueOrThrow({ where: { id: leaveId }, select: leaveSelect });
  });
  res.json({ data });
});

async function sendAttachment(res: Response, leave: { attachmentName: string | null; attachmentMime: string | null; attachmentData: Uint8Array | null } | null) {
  if (!leave?.attachmentData || !leave.attachmentName || !leave.attachmentMime) throw new AppError(404, "LEAVE_ATTACHMENT_NOT_FOUND", "Leave attachment not found");
  const data = Buffer.from(leave.attachmentData);
  res.set({ "Content-Type": leave.attachmentMime, "Content-Length": String(data.length), "Content-Disposition": `attachment; filename="${leave.attachmentName.replace(/["\r\n]/g, "")}"` }).send(data);
}

router.get("/portal/leaves/:leaveId/attachment", async (req: AuthRequest, res) => {
  const leave = await prisma.leaveRequest.findFirst({ where: { id: id.parse(req.params.leaveId), userId: req.auth!.userId }, select: { attachmentName: true, attachmentMime: true, attachmentData: true } });
  await sendAttachment(res, leave);
});

router.get("/admin/leaves", async (req: AuthRequest, res) => {
  if (!administratorRoles.includes(req.auth!.role)) throw new AppError(403, "ADMIN_REQUIRED", "Administrator access is required");
  const q = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20), branchId: id.optional(), status: z.nativeEnum(LeaveRequestStatus).optional(), applicantRole: z.enum([Role.STUDENT, Role.TEACHER]).optional(), search: z.string().trim().optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional() }).parse(req.query);
  if (q.from && q.to && day(q.to) < day(q.from)) throw new AppError(422, "INVALID_DATES", "End date must be on or after start date");
  if (q.branchId) await branchAccess(req, q.branchId);
  const branchIds = req.auth!.role === Role.BRANCH_ADMIN ? (await prisma.branchUser.findMany({ where: { userId: req.auth!.userId }, select: { branchId: true } })).map(row => row.branchId) : undefined;
  const scope = branchIds ? { branchId: { in: branchIds } } : {};
  const where = { ...scope, ...(q.branchId ? { branchId: q.branchId } : {}), ...(q.status ? { status: q.status } : {}), ...(q.applicantRole ? { user: { role: q.applicantRole } } : {}), ...(q.from || q.to ? { fromDate: q.to ? { lte: day(q.to) } : undefined, toDate: q.from ? { gte: day(q.from) } : undefined } : {}), ...(q.search ? { OR: [{ user: { name: { contains: q.search, mode: "insensitive" as const } } }, { reason: { contains: q.search, mode: "insensitive" as const } }] } : {}) };
  const [data, total, pendingStudents, pendingTeachers, branches] = await prisma.$transaction([
    prisma.leaveRequest.findMany({ where, select: leaveSelect, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { createdAt: "desc" } }), prisma.leaveRequest.count({ where }),
    prisma.leaveRequest.count({ where: { ...scope, status: LeaveRequestStatus.PENDING, user: { role: Role.STUDENT } } }), prisma.leaveRequest.count({ where: { ...scope, status: LeaveRequestStatus.PENDING, user: { role: Role.TEACHER } } }),
    prisma.branch.findMany({ where: branchIds ? { id: { in: branchIds } } : {}, select: { id: true, branchName: true }, orderBy: { branchName: "asc" } }),
  ]);
  res.json({ data, meta: { total, page: q.page, limit: q.limit, totalPages: Math.max(1, Math.ceil(total / q.limit)), pendingStudents, pendingTeachers, branches } });
});

router.get("/admin/leaves/:leaveId/attachment", async (req: AuthRequest, res) => {
  if (!administratorRoles.includes(req.auth!.role)) throw new AppError(403, "ADMIN_REQUIRED", "Administrator access is required");
  const leave = await prisma.leaveRequest.findUnique({ where: { id: id.parse(req.params.leaveId) }, select: { branchId: true, attachmentName: true, attachmentMime: true, attachmentData: true } });
  if (leave) await branchAccess(req, leave.branchId);
  await sendAttachment(res, leave);
});

router.patch("/admin/leaves/:leaveId/decision", async (req: AuthRequest, res) => {
  if (!administratorRoles.includes(req.auth!.role)) throw new AppError(403, "ADMIN_REQUIRED", "Administrator access is required");
  const decision = z.object({ status: z.enum([LeaveRequestStatus.APPROVED, LeaveRequestStatus.REJECTED]), remarks: z.string().trim().max(2000).nullable().optional() }).parse(req.body);
  if (decision.status === LeaveRequestStatus.REJECTED && (!decision.remarks?.trim() || decision.remarks.trim().length < 3)) throw new AppError(422, "REJECTION_REASON_REQUIRED", "A rejection reason of at least 3 characters is required");
  const leave = await prisma.leaveRequest.findUnique({ where: { id: id.parse(req.params.leaveId) }, include: { user: { include: { studentProfile: true, teacherProfile: true } } } });
  if (!leave) throw new AppError(404, "LEAVE_NOT_FOUND", "Leave request not found");
  await branchAccess(req, leave.branchId);
  const result = await prisma.$transaction(async tx => {
    const reviewedAt = new Date(), claimed = await tx.leaveRequest.updateMany({ where: { id: leave.id, status: LeaveRequestStatus.PENDING }, data: { status: decision.status, remarks: decision.remarks, approvedById: req.auth!.userId, approvedAt: reviewedAt } });
    if (claimed.count !== 1) throw new AppError(409, "LEAVE_ALREADY_DECIDED", "Only pending requests can be approved or rejected");
    let attendanceChanges = 0;
    if (decision.status === LeaveRequestStatus.APPROVED) {
      const attendanceStatus = attendanceStatusForLeave(leave.leaveType);
      for (let date = day(leave.fromDate); date <= day(leave.toDate); date = new Date(date.getTime() + 86_400_000)) {
        const remarks = `Approved ${leave.leaveType.toLowerCase().replaceAll("_", " ")}${leave.halfDaySession ? ` (${leave.halfDaySession.toLowerCase().replaceAll("_", " ")})` : ""}: ${leave.reason}`;
        if (leave.user.studentProfile) {
          const key = { studentId: leave.userId, batchId: leave.user.studentProfile.batchId, date }, existing = await tx.attendance.findUnique({ where: { studentId_batchId_date: key } });
          assertLeaveAttendanceCompatible(existing?.status ?? null, attendanceStatus, "Student", date);
          if (!existing) await tx.attendance.create({ data: { ...key, status: attendanceStatus, remarks, markedById: req.auth!.userId } }); else if (existing.status !== attendanceStatus) await tx.attendance.update({ where: { id: existing.id }, data: { status: attendanceStatus, remarks, markedById: req.auth!.userId } });
          if (!existing || existing.status !== attendanceStatus) attendanceChanges++;
        }
        if (leave.user.teacherProfile) {
          const teacherId = leave.user.teacherProfile.id, existing = await tx.teacherAttendance.findUnique({ where: { teacherId_date: { teacherId, date } } });
          assertLeaveAttendanceCompatible(existing?.status ?? null, attendanceStatus, "Teacher", date);
          if (!existing) await tx.teacherAttendance.create({ data: { teacherId, date, status: attendanceStatus, remarks, markedById: req.auth!.userId } }); else if (existing.status !== attendanceStatus) await tx.teacherAttendance.update({ where: { id: existing.id }, data: { status: attendanceStatus, remarks, markedById: req.auth!.userId } });
          if (!existing || existing.status !== attendanceStatus) attendanceChanges++;
        }
      }
      await tx.auditLog.create({ data: { organizationId: req.auth!.organizationId, actorId: req.auth!.userId, action: "ATTENDANCE_SYNCHRONIZED_FROM_LEAVE", entity: "LeaveRequest", entityId: leave.id, metadata: { attendanceStatus, attendanceChanges } } });
    }
    await tx.auditLog.create({ data: { organizationId: req.auth!.organizationId, actorId: req.auth!.userId, action: decision.status === LeaveRequestStatus.APPROVED ? "APPROVE" : "REJECT", entity: "LeaveRequest", entityId: leave.id, metadata: { remarks: decision.remarks } } });
    await tx.notification.create({ data: { organizationId: req.auth!.organizationId, userId: leave.userId, title: `Leave ${decision.status.toLowerCase()}`, body: decision.remarks || `Your leave request has been ${decision.status.toLowerCase()}.`, category: "LEAVE", sourceModule: "LEAVE_MANAGEMENT", sourceEntityId: leave.id, actionUrl: "/portal/leaves" } });
    return tx.leaveRequest.findUniqueOrThrow({ where: { id: leave.id }, select: leaveSelect });
  });
  res.json({ data: result });
});

export default router;
