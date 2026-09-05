import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { AttendanceStatus, ExaminationStatus, HomeworkStatus, PaymentMode, Role, StudentStatus, TeacherAllocationStatus, TimetableStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/http.js";
import { assertHomeworkAttachmentAccess } from "../lib/homework-policy.js";
import { loadAuthorizedDocument, storedDocumentBuffer, storedDocumentHeaders } from "../lib/secure-download.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);
const portalRoles: Role[] = [Role.PARENT, Role.STUDENT, Role.TEACHER];
router.use(allow(...portalRoles));

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).default(""),
});
const id = (req: AuthRequest) => req.auth!.userId;
const assertRole = (req: AuthRequest, role: Role) => {
  if (req.auth!.role !== role) throw new AppError(403, "FORBIDDEN", `${role.toLowerCase()} access is required`);
};
const studentForUser = (userId: string) => prisma.studentProfile.findUnique({ where: { userId }, include: { user: true, branch: true, batch: { include: { course: true } } } });
const teacherForUser = (userId: string) => prisma.teacherProfile.findUnique({ where: { userId }, include: { user: true, branch: true } });
async function authorizedTeacherBatchIds(teacherId: string) {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const [timetables, allocations] = await Promise.all([
    prisma.timetable.findMany({ where: { teacherId, status: TimetableStatus.ACTIVE }, select: { batchId: true } }),
    prisma.teacherAllocation.findMany({ where: { teacherId, status: TeacherAllocationStatus.ACTIVE, effectiveFrom: { lte: today }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] }, select: { batchId: true } }),
  ]);
  return [...new Set([...timetables, ...allocations].map(item => item.batchId))];
}
type PortalMessageParticipant = {
  id: string;
  organizationId: string;
  role: Role;
  isActive: boolean;
  teacherId: string | null;
  studentBatchId: string | null;
  childBatchIds: string[];
};
type PortalMessageAuthorizationStore = {
  participant: (userId: string) => Promise<PortalMessageParticipant | null>;
  teacherBatchIds: (teacherId: string) => Promise<string[]>;
};
const portalMessageParticipant = async (userId: string): Promise<PortalMessageParticipant | null> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      organizationId: true,
      role: true,
      isActive: true,
      teacherProfile: { select: { id: true } },
      studentProfile: { select: { batchId: true, status: true } },
      parentChildren: { select: { student: { select: { batchId: true, status: true, user: { select: { isActive: true } } } } } },
    },
  });
  if (!user) return null;
  return {
    id: user.id,
    organizationId: user.organizationId,
    role: user.role,
    isActive: user.isActive,
    teacherId: user.teacherProfile?.id ?? null,
    studentBatchId: user.studentProfile?.status === "ACTIVE" ? user.studentProfile.batchId : null,
    childBatchIds: [...new Set(user.parentChildren.filter(link => link.student.status === "ACTIVE" && link.student.user.isActive).map(link => link.student.batchId))],
  };
};
const portalMessageAuthorizationStore: PortalMessageAuthorizationStore = {
  participant: portalMessageParticipant,
  teacherBatchIds: authorizedTeacherBatchIds,
};
const unavailableRecipient = () => new AppError(404, "RECIPIENT_NOT_AVAILABLE", "Recipient is not available");
const sharesBatch = (left: readonly string[], right: readonly string[]) => {
  const allowed = new Set(left);
  return right.some(batchId => allowed.has(batchId));
};
export async function assertPortalMessageRecipientAuthorized(
  sender: { userId: string; role: Role; organizationId: string },
  recipientId: string,
  store: PortalMessageAuthorizationStore = portalMessageAuthorizationStore,
) {
  const [senderProfile, recipient] = await Promise.all([store.participant(sender.userId), store.participant(recipientId)]);
  const validParticipants = senderProfile
    && recipient
    && senderProfile.id !== recipient.id
    && senderProfile.organizationId === sender.organizationId
    && recipient.organizationId === sender.organizationId
    && senderProfile.role === sender.role
    && senderProfile.isActive
    && recipient.isActive
    && portalRoles.includes(senderProfile.role)
    && portalRoles.includes(recipient.role);
  if (!validParticipants) throw unavailableRecipient();

  let permitted = false;
  if (sender.role === Role.TEACHER && senderProfile.teacherId) {
    const batchIds = await store.teacherBatchIds(senderProfile.teacherId);
    permitted = recipient.role === Role.STUDENT
      ? Boolean(recipient.studentBatchId && batchIds.includes(recipient.studentBatchId))
      : recipient.role === Role.PARENT && sharesBatch(batchIds, recipient.childBatchIds);
  } else if (sender.role === Role.STUDENT && senderProfile.studentBatchId && recipient.role === Role.TEACHER && recipient.teacherId) {
    permitted = (await store.teacherBatchIds(recipient.teacherId)).includes(senderProfile.studentBatchId);
  } else if (sender.role === Role.PARENT && senderProfile.childBatchIds.length && recipient.role === Role.TEACHER && recipient.teacherId) {
    permitted = sharesBatch(senderProfile.childBatchIds, await store.teacherBatchIds(recipient.teacherId));
  }
  if (!permitted) throw unavailableRecipient();
  return recipient;
}
const teacherContactRelationship = (batchIds: string[], today: Date) => ({
  OR: [
    { timetables: { some: { batchId: { in: batchIds }, status: TimetableStatus.ACTIVE } } },
    { allocations: { some: { batchId: { in: batchIds }, status: TeacherAllocationStatus.ACTIVE, effectiveFrom: { lte: today }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] } } },
  ],
});
async function ownedChild(parentId: string, studentId: string) {
  const link = await prisma.parentStudent.findUnique({ where: { parentId_studentId: { parentId, studentId } }, include: { student: { include: { user: true, branch: true, batch: { include: { course: true } } } } } });
  if (!link) throw new AppError(403, "CHILD_ACCESS_DENIED", "This student is not linked to your account");
  return link.student;
}

router.get("/profile", async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: id(req) }, select: { id: true, name: true, email: true, phone: true, avatarUrl: true, role: true, createdAt: true, studentProfile: { include: { branch: true, batch: { include: { course: true } } } }, teacherProfile: { include: { branch: true } }, parentChildren: { include: { student: { include: { user: { select: { name: true } } } } } } } });
  res.json({ data: user });
});
router.patch("/profile", async (req: AuthRequest, res) => {
  const input = z.object({ name: z.string().trim().min(2).max(100), phone: z.string().regex(/^\+?[0-9]{10,15}$/).nullable().optional(), avatarUrl: z.string().url().max(500).nullable().optional() }).parse(req.body);
  const user = await prisma.user.update({ where: { id: id(req) }, data: input, select: { id: true, name: true, email: true, phone: true, avatarUrl: true, role: true } });
  res.json({ data: user });
});
router.post("/change-password", async (req: AuthRequest, res) => {
  const input = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(10).max(100).regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/) }).parse(req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: id(req) }, select: { passwordHash: true } });
  if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) throw new AppError(400, "INVALID_PASSWORD", "Current password is incorrect");
  await prisma.$transaction([prisma.user.update({ where: { id: id(req) }, data: { passwordHash: await bcrypt.hash(input.newPassword, 12) } }), prisma.session.deleteMany({ where: { userId: id(req) } })]);
  res.status(204).end();
});
router.get("/sessions", async (req: AuthRequest, res) => res.json({ data: await prisma.session.findMany({ where: { userId: id(req) }, select: { id: true, createdAt: true, expiresAt: true }, orderBy: { createdAt: "desc" } }) }));
router.delete("/sessions/:sessionId", async (req: AuthRequest, res) => { await prisma.session.deleteMany({ where: { id: String(req.params.sessionId), userId: id(req) } }); res.status(204).end(); });

router.get("/notifications", async (req: AuthRequest, res) => {
  const q = pageSchema.extend({ unread: z.enum(["true", "false"]).optional() }).parse(req.query); const where = { userId: id(req), ...(q.unread === "true" ? { readAt: null } : {}), ...(q.search ? { OR: [{ title: { contains: q.search, mode: "insensitive" as const } }, { body: { contains: q.search, mode: "insensitive" as const } }] } : {}) };
  const [data, total] = await Promise.all([prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.limit, take: q.limit }), prisma.notification.count({ where })]); res.json({ data, meta: { ...q, total, pages: Math.ceil(total / q.limit) } });
});
router.patch("/notifications/:notificationId/read", async (req: AuthRequest, res) => { const found = await prisma.notification.findFirst({ where: { id: String(req.params.notificationId), userId: id(req) } }); if (!found) throw new AppError(404, "NOT_FOUND", "Notification not found"); res.json({ data: await prisma.notification.update({ where: { id: found.id }, data: { readAt: new Date() } }) }); });
router.delete("/notifications/:notificationId", async (req: AuthRequest, res) => { await prisma.notification.deleteMany({ where: { id: String(req.params.notificationId), userId: id(req) } }); res.status(204).end(); });

router.get("/messages", async (req: AuthRequest, res) => { const q = pageSchema.parse(req.query); const where = { OR: [{ senderId: id(req), senderArchived: false }, { recipientId: id(req), recipientArchived: false }], ...(q.search ? { AND: { OR: [{ subject: { contains: q.search, mode: "insensitive" as const } }, { body: { contains: q.search, mode: "insensitive" as const } }] } } : {}) }; const [data,total]=await Promise.all([prisma.portalMessage.findMany({where,include:{sender:{select:{id:true,name:true,role:true}},recipient:{select:{id:true,name:true,role:true}}},orderBy:{createdAt:"desc"},skip:(q.page-1)*q.limit,take:q.limit}),prisma.portalMessage.count({where})]); res.json({data,meta:{...q,total,pages:Math.ceil(total/q.limit)}}); });
router.post("/messages", async (req: AuthRequest, res) => {
  const input = z.object({ recipientId: z.string().cuid(), subject: z.string().trim().min(2).max(160), body: z.string().trim().min(1).max(5000) }).parse(req.body);
  await assertPortalMessageRecipientAuthorized({ userId: id(req), role: req.auth!.role, organizationId: req.auth!.organizationId }, input.recipientId);
  res.status(201).json({ data: await prisma.portalMessage.create({ data: { senderId: id(req), ...input } }) });
});
router.patch("/messages/:messageId", async (req: AuthRequest,res)=>{const input=z.object({read:z.boolean().optional(),archived:z.boolean().optional()}).parse(req.body);const message=await prisma.portalMessage.findUnique({where:{id:String(req.params.messageId)}});if(!message||(message.senderId!==id(req)&&message.recipientId!==id(req)))throw new AppError(404,"NOT_FOUND","Message not found");const data=message.senderId===id(req)?{senderArchived:input.archived}:{recipientArchived:input.archived,...(input.read?{readAt:new Date()}: {})};res.json({data:await prisma.portalMessage.update({where:{id:message.id},data})});});
router.get("/contacts", async (req: AuthRequest, res) => {
  let data: { id: string; name: string; role: Role }[] = [];
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  if (req.auth!.role === Role.STUDENT) {
    const student = await studentForUser(id(req));
    if (student?.status === "ACTIVE" && student.user.isActive) data = await prisma.user.findMany({ where: { role: Role.TEACHER, isActive: true, teacherProfile: teacherContactRelationship([student.batchId], today) }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } });
  } else if (req.auth!.role === Role.PARENT) {
    const batchIds = (await prisma.parentStudent.findMany({ where: { parentId: id(req), student: { status: "ACTIVE", user: { isActive: true } } }, select: { student: { select: { batchId: true } } } })).map(link => link.student.batchId);
    data = await prisma.user.findMany({ where: { role: Role.TEACHER, isActive: true, teacherProfile: teacherContactRelationship(batchIds, today) }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } });
  } else {
    const teacher = await teacherForUser(id(req));
    if (teacher) {
      const batchIds = await authorizedTeacherBatchIds(teacher.id);
      data = await prisma.user.findMany({ where: { isActive: true, OR: [{ role: Role.STUDENT, studentProfile: { batchId: { in: batchIds }, status: "ACTIVE" } }, { role: Role.PARENT, parentChildren: { some: { student: { batchId: { in: batchIds }, status: "ACTIVE", user: { isActive: true } } } } }] }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } });
    }
  }
  res.json({ data });
});

router.get("/announcements", async (req: AuthRequest,res)=>{const q=pageSchema.parse(req.query);let branchId:string|undefined;if(req.auth!.role===Role.STUDENT)branchId=(await studentForUser(id(req)))?.branchId;if(req.auth!.role===Role.TEACHER)branchId=(await teacherForUser(id(req)))?.branchId;const where={isArchived:false,AND:[{OR:[{audience:null},{audience:req.auth!.role}]},{OR:[{branchId:null},...(branchId?[{branchId}]:[])]}],...(q.search?{OR:[{title:{contains:q.search,mode:"insensitive" as const}},{body:{contains:q.search,mode:"insensitive" as const}}]}:{})};const [data,total]=await Promise.all([prisma.announcement.findMany({where,include:{author:{select:{name:true,role:true}}},orderBy:{publishedAt:"desc"},skip:(q.page-1)*q.limit,take:q.limit}),prisma.announcement.count({where})]);res.json({data,meta:{...q,total,pages:Math.ceil(total/q.limit)}});});
router.post("/announcements",allow(Role.TEACHER),async(req:AuthRequest,res)=>{const teacher=await teacherForUser(id(req));if(!teacher)throw new AppError(404,"PROFILE_NOT_FOUND","Teacher profile not found");const input=z.object({title:z.string().trim().min(2).max(160),body:z.string().trim().min(1).max(10000),audience:z.nativeEnum(Role).refine(v=>v===Role.STUDENT||v===Role.PARENT)}).parse(req.body);res.status(201).json({data:await prisma.announcement.create({data:{...input,branchId:teacher.branchId,authorId:id(req)}})});});
router.patch("/announcements/:announcementId/archive",allow(Role.TEACHER),async(req:AuthRequest,res)=>{const a=await prisma.announcement.findFirst({where:{id:String(req.params.announcementId),authorId:id(req)}});if(!a)throw new AppError(404,"NOT_FOUND","Announcement not found");res.json({data:await prisma.announcement.update({where:{id:a.id},data:{isArchived:true}})});});
router.delete("/announcements/:announcementId",allow(Role.TEACHER),async(req:AuthRequest,res)=>{await prisma.announcement.deleteMany({where:{id:String(req.params.announcementId),authorId:id(req),isArchived:true}});res.status(204).end();});

router.get("/leaves",async(req:AuthRequest,res)=>res.json({data:await prisma.leaveRequest.findMany({where:{userId:id(req)},orderBy:{createdAt:"desc"}})}));
router.post("/leaves",async(req:AuthRequest,res)=>{const input=z.object({fromDate:z.coerce.date(),toDate:z.coerce.date(),reason:z.string().trim().min(3).max(2000)}).parse(req.body);if(input.toDate<input.fromDate)throw new AppError(400,"INVALID_DATES","End date must be on or after start date");let branchId:string|undefined;if(req.auth!.role===Role.STUDENT)branchId=(await studentForUser(id(req)))?.branchId;if(req.auth!.role===Role.TEACHER)branchId=(await teacherForUser(id(req)))?.branchId;if(req.auth!.role===Role.PARENT)branchId=(await prisma.parentStudent.findFirst({where:{parentId:id(req)},select:{student:{select:{branchId:true}}}}))?.student.branchId;if(!branchId)throw new AppError(400,"BRANCH_REQUIRED","A linked branch is required");const duplicate=await prisma.leaveRequest.findFirst({where:{userId:id(req),fromDate:input.fromDate,toDate:input.toDate}});if(duplicate)throw new AppError(409,"DUPLICATE_LEAVE","A leave request already exists for these dates");res.status(201).json({data:await prisma.leaveRequest.create({data:{...input,userId:id(req),branchId}})});});
router.delete("/leaves/:leaveId",async(req:AuthRequest,res)=>{const result=await prisma.leaveRequest.deleteMany({where:{id:String(req.params.leaveId),userId:id(req),status:"PENDING"}});if(!result.count)throw new AppError(409,"LEAVE_LOCKED","Only pending leave requests can be deleted");res.status(204).end();});

async function studentData(student: NonNullable<Awaited<ReturnType<typeof studentForUser>>>) {
  const [attendance, homeworks, timetable, examinations, fees, certificates, progress] = await Promise.all([
    prisma.attendance.findMany({ where: { studentId: student.userId }, select: { id: true, date: true, status: true, remarks: true, batch: { select: { id: true, name: true, course: { select: { title: true } } } } }, orderBy: { date: "desc" }, take: 100 }),
    prisma.homework.findMany({ where: { batchId: student.batchId, status: { in: [HomeworkStatus.PUBLISHED, HomeworkStatus.CLOSED] } }, select: { id: true, title: true, description: true, type: true, assignedDate: true, dueDate: true, maximumMarks: true, status: true, attachmentName: true, subject: { select: { id: true, name: true } }, teacher: { select: { id: true, user: { select: { name: true } } } }, course: { select: { id: true, title: true } }, batch: { select: { id: true, name: true } }, submissions: { where: { studentId: student.id }, select: { id: true, submittedAt: true, attachmentName: true, answerText: true, marksObtained: true, feedback: true, status: true, evaluatedAt: true }, orderBy: { submittedAt: "desc" }, take: 1 } }, orderBy: { dueDate: "asc" }, take: 100 }),
    prisma.timetable.findMany({ where: { batchId: student.batchId, status: TimetableStatus.ACTIVE }, select: { id: true, day: true, startMinute: true, endMinute: true, periodNumber: true, academicSession: true, subject: { select: { id: true, name: true } }, teacher: { select: { id: true, user: { select: { name: true } } } }, course: { select: { id: true, title: true } }, batch: { select: { id: true, name: true } }, classroom: { select: { id: true, name: true } } }, orderBy: [{ day: "asc" }, { startMinute: "asc" }] }),
    prisma.examination.findMany({ where: { batchId: student.batchId, academicSessionId: student.academicSessionId, status: { in: [ExaminationStatus.SCHEDULED, ExaminationStatus.COMPLETED, ExaminationStatus.RESULTS_PUBLISHED] } }, select: { id: true, name: true, type: true, status: true, examDate: true, startMinute: true, endMinute: true, maximumMarks: true, subject: { select: { id: true, name: true } }, results: { where: { studentId: student.id }, select: { id: true, marksObtained: true, percentage: true, grade: true, rank: true, status: true } }, answerSheets: { where: { studentId: student.id }, select: { id: true, status: true, finalizedAt: true } } }, orderBy: { examDate: "asc" } }),
    prisma.fee.findMany({ where: { studentId: student.id }, select: { id: true, feeHead: true, totalPaise: true, discountPaise: true, finePaise: true, amountPaidPaise: true, dueDate: true, status: true, remarks: true, payments: { select: { id: true, amountPaise: true, paymentDate: true, paymentMode: true, receiptNumber: true }, orderBy: { paymentDate: "desc" } } }, orderBy: { dueDate: "desc" } }),
    prisma.certificate.findMany({ where: { studentId: student.id, status: { not: "ARCHIVED" } }, select: { id: true, certificateNumber: true, type: true, purpose: true, issueDate: true, status: true }, orderBy: { issueDate: "desc" } }),
    prisma.lessonProgress.findMany({ where: { userId: student.userId }, select: { id: true, completed: true, watchPercentage: true, updatedAt: true, lesson: { select: { id: true, title: true, subject: { select: { id: true, name: true } } } } }, orderBy: { updatedAt: "desc" } }),
  ]);
  const present = attendance.filter(item => item.status === AttendanceStatus.PRESENT || item.status === AttendanceStatus.LATE).length;
  const leaveStatuses: AttendanceStatus[] = [AttendanceStatus.LEAVE, AttendanceStatus.EXCUSED, AttendanceStatus.FULL_DAY_LEAVE, AttendanceStatus.HALF_DAY_LEAVE, AttendanceStatus.SHORT_LEAVE];
  const summary = { total: attendance.length, present: attendance.filter(item => item.status === AttendanceStatus.PRESENT).length, absent: attendance.filter(item => item.status === AttendanceStatus.ABSENT).length, late: attendance.filter(item => item.status === AttendanceStatus.LATE).length, leave: attendance.filter(item => leaveStatuses.includes(item.status)).length };
  return {
    profile: { name: student.user.name, admissionNo: student.admissionNo, rollNo: student.rollNo, status: student.status, academicSession: student.academicSession, branch: { id: student.branch.id, name: student.branch.branchName }, course: student.batch.course ? { id: student.batch.course.id, name: student.batch.course.title } : { id: "", name: "Course not assigned" }, batch: { id: student.batch.id, name: student.batch.name } },
    attendance: { records: attendance, summary, percentage: attendance.length ? Math.round(present * 10000 / attendance.length) / 100 : 0 },
    homework: { assignments: homeworks.map(item => ({ ...item, hasAttachment: Boolean(item.attachmentName), submission: item.submissions[0] ?? null, submissions: undefined })) },
    timetable,
    examinations: examinations.map(item => ({ ...item, result: item.status === ExaminationStatus.RESULTS_PUBLISHED ? item.results[0] ?? null : null, submission: item.answerSheets[0] ?? null, results: undefined, answerSheets: undefined })),
    fees,
    certificates,
    lms: { progress, continueLearning: progress.filter(item => !item.completed).slice(0, 10), completed: progress.filter(item => item.completed) },
  };
}

router.get("/student/dashboard",allow(Role.STUDENT),async(req:AuthRequest,res)=>{const student=await studentForUser(id(req));if(!student)throw new AppError(404,"PROFILE_NOT_FOUND","Student profile not found");res.json({data:await studentData(student)});});
router.get("/parent/children", allow(Role.PARENT), async (req: AuthRequest, res) => {
  const data = await prisma.parentStudent.findMany({
    where: { parentId: id(req) },
    include: { student: { include: { user: { select: { name: true, email: true, phone: true, avatarUrl: true } }, branch: true, batch: { include: { course: true } } } } },
  });
  res.json({ data });
});
router.get("/parent/dashboard",allow(Role.PARENT),async(req:AuthRequest,res)=>{const links=await prisma.parentStudent.findMany({where:{parentId:id(req)},include:{student:{include:{user:true,branch:true,batch:{include:{course:true}}}}}});const children=await Promise.all(links.map(l=>studentData(l.student)));res.json({data:{children}});});
router.get("/parent/children/:studentId",allow(Role.PARENT),async(req:AuthRequest,res)=>res.json({data:await studentData(await ownedChild(id(req),String(req.params.studentId)))}));
router.post("/parent/children/:studentId/fees/:feeId/pay",allow(Role.PARENT),async(req:AuthRequest,res)=>{const student=await ownedChild(id(req),String(req.params.studentId));const input=z.object({amountPaise:z.number().int().positive(),paymentMode:z.nativeEnum(PaymentMode),transactionId:z.string().trim().max(100).optional()}).parse(req.body);const fee=await prisma.fee.findFirst({where:{id:String(req.params.feeId),studentId:student.id}});if(!fee)throw new AppError(404,"FEE_NOT_FOUND","Fee record not found");const balance=fee.totalPaise-fee.discountPaise+fee.finePaise-fee.amountPaidPaise;if(input.amountPaise>balance)throw new AppError(400,"EXCESS_PAYMENT","Payment exceeds the outstanding balance");const receiptNumber=`PR-${Date.now()}-${randomUUID().slice(0,6).toUpperCase()}`;const paid=fee.amountPaidPaise+input.amountPaise;const payment=await prisma.$transaction(async tx=>{const p=await tx.feePayment.create({data:{feeId:fee.id,amountPaise:input.amountPaise,paymentMode:input.paymentMode,transactionId:input.transactionId,receiptNumber,collectedById:id(req)}});await tx.fee.update({where:{id:fee.id},data:{amountPaidPaise:paid,status:paid>=fee.totalPaise-fee.discountPaise+fee.finePaise?"PAID":"PARTIAL"}});return p;});res.status(201).json({data:payment});});

router.get("/teacher/dashboard", allow(Role.TEACHER), async (req: AuthRequest, res) => {
  const teacher = await teacherForUser(id(req));
  if (!teacher) throw new AppError(404, "PROFILE_NOT_FOUND", "Teacher profile not found");
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const [timetable, allocations] = await Promise.all([
    prisma.timetable.findMany({ where: { teacherId: teacher.id, status: TimetableStatus.ACTIVE }, select: { id: true, batchId: true, subjectId: true, day: true, startMinute: true, endMinute: true, periodNumber: true, academicSession: true, branch: { select: { id: true, branchName: true } }, course: { select: { id: true, title: true } }, batch: { select: { id: true, name: true } }, subject: { select: { id: true, name: true } }, classroom: { select: { id: true, name: true } } }, orderBy: [{ day: "asc" }, { startMinute: "asc" }] }),
    prisma.teacherAllocation.findMany({ where: { teacherId: teacher.id, status: TeacherAllocationStatus.ACTIVE, effectiveFrom: { lte: today }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] }, select: { id: true, batchId: true, subjectId: true, weeklyPeriods: true, effectiveFrom: true, effectiveTo: true, branch: { select: { id: true, branchName: true } }, course: { select: { id: true, title: true } }, batch: { select: { id: true, name: true } }, subject: { select: { id: true, name: true } } }, orderBy: [{ batch: { name: "asc" } }, { subject: { name: "asc" } }] }),
  ]);
  const batchIds = [...new Set([...timetable, ...allocations].map(item => item.batchId))];
  const [homework, examinations, attendance, students] = await Promise.all([
    prisma.homework.findMany({ where: { teacherId: teacher.id }, select: { id: true, title: true, description: true, type: true, assignedDate: true, dueDate: true, maximumMarks: true, status: true, attachmentName: true, branch: { select: { id: true, branchName: true } }, course: { select: { id: true, title: true } }, batch: { select: { id: true, name: true } }, subject: { select: { id: true, name: true } }, _count: { select: { submissions: true } }, submissions: { where: { status: { in: ["SUBMITTED", "LATE"] } }, select: { id: true } } }, orderBy: { dueDate: "desc" } }),
    prisma.examination.findMany({ where: { teacherId: teacher.id }, select: { id: true, name: true, type: true, status: true, examDate: true, startMinute: true, endMinute: true, maximumMarks: true, branch: { select: { id: true, branchName: true } }, course: { select: { id: true, title: true } }, batch: { select: { id: true, name: true } }, subject: { select: { id: true, name: true } }, questionPaper: { select: { id: true, fileName: true, publishedAt: true } }, _count: { select: { answerSheets: true, results: true } } }, orderBy: { examDate: "desc" } }),
    prisma.attendance.findMany({ where: { teacherId: teacher.id, ...(batchIds.length ? { batchId: { in: batchIds } } : { batchId: { in: [] } }) }, select: { id: true, date: true, status: true, remarks: true, student: { select: { name: true, studentProfile: { select: { admissionNo: true } } } }, batch: { select: { id: true, name: true, course: { select: { title: true } } } } }, orderBy: { date: "desc" }, take: 100 }),
    prisma.studentProfile.findMany({ where: { batchId: { in: batchIds }, status: "ACTIVE" }, select: { id: true, admissionNo: true, rollNo: true, status: true, user: { select: { id: true, name: true, email: true, phone: true } }, branch: { select: { id: true, branchName: true } }, batch: { select: { id: true, name: true, course: { select: { id: true, title: true } } } } }, orderBy: [{ batch: { name: "asc" } }, { rollNo: "asc" }] }),
  ]);
  const studentCount = new Map<string, number>();
  for (const student of students) studentCount.set(student.batch.id, (studentCount.get(student.batch.id) ?? 0) + 1);
  res.json({ data: {
    profile: { id: teacher.id, name: teacher.user.name, employeeNo: teacher.employeeNo, qualification: teacher.qualification, specialization: teacher.specialization, branch: { id: teacher.branch.id, name: teacher.branch.branchName } },
    myClasses: allocations.map(item => ({ ...item, studentCount: studentCount.get(item.batch.id) ?? 0, schedule: timetable.filter(period => period.batchId === item.batchId && period.subjectId === item.subjectId) })),
    timetable,
    homework: homework.map(item => ({ ...item, hasAttachment: Boolean(item.attachmentName), pendingEvaluation: item.submissions.length, submissions: undefined })),
    examinations,
    attendance,
    students: students.map(student => ({ id: student.id, attendanceTargetId: student.user.id, admissionNo: student.admissionNo, rollNo: student.rollNo, status: student.status, name: student.user.name, email: student.user.email, phone: student.user.phone, branch: { id: student.branch.id, name: student.branch.branchName }, course: student.batch.course ? { id: student.batch.course.id, name: student.batch.course.title } : { id: "", name: "Course not assigned" }, batch: { id: student.batch.id, name: student.batch.name } })),
  } });
});
router.post("/teacher/attendance", allow(Role.TEACHER), async () => { throw new AppError(410, "USE_ATTENDANCE_WORKFLOW", "Use the protected attendance workflow"); });

async function mayAccessStudent(req: AuthRequest, studentId: string) {
  if (req.auth!.role === Role.STUDENT) return Boolean(await prisma.studentProfile.findFirst({ where: { id: studentId, userId: id(req) } }));
  if (req.auth!.role === Role.PARENT) return Boolean(await prisma.parentStudent.findUnique({ where: { parentId_studentId: { parentId: id(req), studentId } } }));
  const teacher = await teacherForUser(id(req)); const student = teacher && await prisma.studentProfile.findUnique({ where: { id: studentId }, select: { branchId: true } }); return Boolean(teacher && student?.branchId === teacher.branchId);
}
router.get("/downloads/homework/:homeworkId", async (req: AuthRequest, res) => {
  const homework = await prisma.homework.findFirst({
    where: { id: String(req.params.homeworkId), organizationId: req.auth!.organizationId },
    select: { organizationId: true, branchId: true, batchId: true, teacherId: true, status: true, attachmentName: true, attachmentMime: true, attachmentSize: true },
  });
  if (!homework) throw new AppError(404, "HOMEWORK_NOT_FOUND", "Homework not found");

  const student = req.auth!.role === Role.STUDENT
    ? await prisma.studentProfile.findFirst({
      where: { userId: id(req), organizationId: req.auth!.organizationId },
      select: { organizationId: true, batchId: true, status: true },
    })
    : null;
  const linked = req.auth!.role === Role.PARENT
    ? await prisma.parentStudent.findFirst({
      where: {
        parentId: id(req),
        organizationId: req.auth!.organizationId,
        student: { organizationId: req.auth!.organizationId, batchId: homework.batchId, status: StudentStatus.ACTIVE },
      },
      select: { student: { select: { organizationId: true, batchId: true, status: true } } },
    })
    : null;
  const teacher = req.auth!.role === Role.TEACHER ? await teacherForUser(id(req)) : null;
  const branch = req.auth!.role === Role.BRANCH_ADMIN
    ? await prisma.branchUser.findFirst({ where: { userId: id(req), branchId: homework.branchId }, select: { branchId: true } })
    : null;
  const download = await loadAuthorizedDocument(() => assertHomeworkAttachmentAccess({
      role: req.auth!.role,
      requestOrganizationId: req.auth!.organizationId,
      homeworkOrganizationId: homework.organizationId,
      homeworkStatus: homework.status,
      homeworkBatchId: homework.batchId,
      homeworkTeacherId: homework.teacherId,
      studentOrganizationId: student?.organizationId,
      studentBatchId: student?.batchId,
      studentStatus: student?.status,
      parentLinked: Boolean(linked),
      parentStudentOrganizationId: linked?.student.organizationId,
      parentStudentBatchId: linked?.student.batchId,
      parentStudentStatus: linked?.student.status,
      teacherId: teacher?.id,
      branchAllowed: Boolean(branch),
    }), async () => {
      if (!homework.attachmentName || !homework.attachmentMime || homework.attachmentSize === null) throw new AppError(404, "ATTACHMENT_NOT_FOUND", "Attachment not found");
      const stored = await prisma.homework.findFirst({
        where: { id: String(req.params.homeworkId), organizationId: req.auth!.organizationId },
        select: { attachmentData: true },
      });
      return { stored, metadata: { fileName: homework.attachmentName, mimeType: homework.attachmentMime, fileSize: homework.attachmentSize } };
    });
  if (!download.stored?.attachmentData) throw new AppError(404, "ATTACHMENT_NOT_FOUND", "Attachment not found");
  res.set(storedDocumentHeaders({ ...download.metadata, fallbackName: "homework-attachment" }, "attachment")).send(storedDocumentBuffer(download.stored.attachmentData));
});
router.get("/downloads/certificate/:certificateId", async (req: AuthRequest, res) => { const c=await prisma.certificate.findUnique({where:{id:String(req.params.certificateId)},include:{student:{include:{user:true,batch:{include:{course:true}}}}}});if(!c||c.status==="DRAFT")throw new AppError(404,"CERTIFICATE_NOT_FOUND","Issued certificate not found");if(!(await mayAccessStudent(req,c.studentId)))throw new AppError(403,"FORBIDDEN","Download access denied");sendPdf(res,`${c.type.replaceAll("_"," ")} CERTIFICATE`,[`Certificate No: ${c.certificateNumber}`,`Student: ${c.student.user.name}`,`Admission: ${c.student.admissionNo}`,`Course: ${c.student.batch.course?.title??"N/A"}`,`Purpose: ${c.purpose}`,`Issued: ${c.issueDate?.toISOString().slice(0,10)??"N/A"}`],`${c.certificateNumber}.pdf`);});
router.get("/downloads/report-card/:resultId", async (req: AuthRequest, res) => { const r=await prisma.examinationResult.findUnique({where:{id:String(req.params.resultId)},include:{student:{include:{user:true,batch:{include:{course:true}}}},examination:{include:{subject:true}}}});if(!r||r.examination.status!==ExaminationStatus.RESULTS_PUBLISHED)throw new AppError(404,"RESULT_NOT_FOUND","Result not found");if(!(await mayAccessStudent(req,r.studentId)))throw new AppError(403,"FORBIDDEN","Download access denied");sendPdf(res,"STUDENT REPORT CARD",[`Student: ${r.student.user.name}`,`Admission: ${r.student.admissionNo} | Roll: ${r.student.rollNo}`,`Course: ${r.student.batch.course?.title??"N/A"}`,`Examination: ${r.examination.name} | Subject: ${r.examination.subject.name}`,`Marks: ${r.marksObtained??"Absent"}/${r.examination.maximumMarks}`,`Percentage: ${r.percentage??"-"}% | Grade: ${r.grade??"-"} | GPA: ${r.gpa??"-"}`,`Rank: ${r.rank??"-"} | Result: ${r.status}`],"report-card.pdf");});
function sendPdf(res:any,title:string,lines:string[],filename:string){const content=[title,...lines].map((x,i)=>`BT /F1 ${i?11:18} Tf 45 ${790-i*35} Td (${x.replace(/[()\\]/g,"\\$&")}) Tj ET`).join("\n"),objects=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];let pdf="%PDF-1.4\n",offsets=[0];objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`});const at=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(x=>String(x).padStart(10,"0")+" 00000 n ").join("\n")}\ntrailer << /Size 6 /Root 1 0 R >>\nstartxref\n${at}\n%%EOF`;res.set({"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="${filename.replace(/["\r\n]/g,"")}"`}).send(Buffer.from(pdf));}

export default router;
