import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { PaymentMode, Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/http.js";
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
router.post("/messages", async (req: AuthRequest, res) => { const input=z.object({recipientId:z.string().cuid(),subject:z.string().trim().min(2).max(160),body:z.string().trim().min(1).max(5000)}).parse(req.body); const recipient=await prisma.user.findUnique({where:{id:input.recipientId},select:{role:true}}); if(!recipient||!portalRoles.includes(recipient.role)) throw new AppError(400,"INVALID_RECIPIENT","Recipient must be a portal user"); if(req.auth!.role===Role.PARENT&&recipient.role!==Role.TEACHER) throw new AppError(403,"FORBIDDEN","Parents may communicate with teachers"); if(req.auth!.role===Role.STUDENT&&recipient.role!==Role.TEACHER) throw new AppError(403,"FORBIDDEN","Students may communicate with teachers"); res.status(201).json({data:await prisma.portalMessage.create({data:{senderId:id(req),...input}})}); });
router.patch("/messages/:messageId", async (req: AuthRequest,res)=>{const input=z.object({read:z.boolean().optional(),archived:z.boolean().optional()}).parse(req.body);const message=await prisma.portalMessage.findUnique({where:{id:String(req.params.messageId)}});if(!message||(message.senderId!==id(req)&&message.recipientId!==id(req)))throw new AppError(404,"NOT_FOUND","Message not found");const data=message.senderId===id(req)?{senderArchived:input.archived}:{recipientArchived:input.archived,...(input.read?{readAt:new Date()}: {})};res.json({data:await prisma.portalMessage.update({where:{id:message.id},data})});});
router.get("/contacts", async (req: AuthRequest, res) => {
  let data: { id: string; name: string; role: Role }[] = [];
  if (req.auth!.role === Role.STUDENT) {
    const student = await studentForUser(id(req));
    if (student) data = await prisma.user.findMany({ where: { role: Role.TEACHER, teacherProfile: { branchId: student.branchId } }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } });
  } else if (req.auth!.role === Role.PARENT) {
    const branchIds = (await prisma.parentStudent.findMany({ where: { parentId: id(req) }, select: { student: { select: { branchId: true } } } })).map(x => x.student.branchId);
    data = await prisma.user.findMany({ where: { role: Role.TEACHER, teacherProfile: { branchId: { in: branchIds } } }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } });
  } else {
    const teacher = await teacherForUser(id(req));
    if (teacher) data = await prisma.user.findMany({ where: { OR: [{ role: Role.STUDENT, studentProfile: { branchId: teacher.branchId } }, { role: Role.PARENT, parentChildren: { some: { student: { branchId: teacher.branchId } } } }] }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } });
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
  const [attendance, homeworks, submissions, timetable, results, fees, certificates, progress] = await Promise.all([
    prisma.attendance.findMany({where:{studentId:student.userId},orderBy:{date:"desc"},take:100}),
    prisma.homework.findMany({where:{batchId:student.batchId,status:{not:"ARCHIVED"}},include:{subject:true,teacher:{include:{user:{select:{name:true}}}}},orderBy:{dueDate:"desc"},take:100}),
    prisma.homeworkSubmission.findMany({where:{studentId:student.id},include:{homework:{select:{title:true,maximumMarks:true}}},orderBy:{submittedAt:"desc"}}),
    prisma.timetable.findMany({where:{batchId:student.batchId,status:"ACTIVE"},include:{subject:true,teacher:{include:{user:{select:{name:true}}}},classroom:true},orderBy:[{day:"asc"},{startMinute:"asc"}]}),
    prisma.examinationResult.findMany({where:{studentId:student.id},include:{examination:{include:{subject:true}}},orderBy:{createdAt:"desc"}}),
    prisma.fee.findMany({where:{studentId:student.id},include:{payments:true},orderBy:{dueDate:"desc"}}),
    prisma.certificate.findMany({where:{studentId:student.id,status:{not:"ARCHIVED"}},orderBy:{createdAt:"desc"}}),
    prisma.lessonProgress.findMany({where:{userId:student.userId},include:{lesson:{include:{subject:true}}},orderBy:{updatedAt:"desc"}}),
  ]);
  const present=attendance.filter(a=>a.status==="PRESENT"||a.status==="LATE").length;
  return {profile:student,attendance:{records:attendance,percentage:attendance.length?Math.round(present*10000/attendance.length)/100:0},homework:{assignments:homeworks,submissions},timetable,examinations:results,fees,certificates,lms:{progress,continueLearning:progress.filter(p=>!p.completed).slice(0,10),completed:progress.filter(p=>p.completed)}};
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

router.get("/teacher/dashboard",allow(Role.TEACHER),async(req:AuthRequest,res)=>{const teacher=await teacherForUser(id(req));if(!teacher)throw new AppError(404,"PROFILE_NOT_FOUND","Teacher profile not found");const [timetable,homework,examinations,attendance,students,certificates]=await Promise.all([prisma.timetable.findMany({where:{teacherId:teacher.id,status:{not:"ARCHIVED"}},include:{batch:true,subject:true,classroom:true},orderBy:[{day:"asc"},{startMinute:"asc"}]}),prisma.homework.findMany({where:{teacherId:teacher.id},include:{batch:true,subject:true,_count:{select:{submissions:true}}},orderBy:{dueDate:"desc"}}),prisma.examination.findMany({where:{teacherId:teacher.id},include:{batch:true,subject:true,_count:{select:{results:true}}},orderBy:{examDate:"desc"}}),prisma.attendance.findMany({where:{teacherId:teacher.id},orderBy:{date:"desc"},take:100}),prisma.studentProfile.findMany({where:{branchId:teacher.branchId,status:"ACTIVE"},include:{user:{select:{name:true,email:true,phone:true}},batch:{include:{course:true}}},orderBy:{rollNo:"asc"}}),prisma.certificate.findMany({where:{branchId:teacher.branchId,status:"ISSUED"},include:{student:{include:{user:{select:{name:true}}}}},take:100,orderBy:{issueDate:"desc"}})]);res.json({data:{profile:teacher,myClasses:timetable,homework,examinations,attendance,students,certificates}});});
router.post("/teacher/attendance",allow(Role.TEACHER),async(req:AuthRequest,res)=>{const teacher=await teacherForUser(id(req));if(!teacher)throw new AppError(404,"PROFILE_NOT_FOUND","Teacher profile not found");const input=z.object({studentUserId:z.string().cuid(),batchId:z.string().cuid(),date:z.coerce.date(),status:z.enum(["PRESENT","ABSENT","LATE","LEAVE"]),remarks:z.string().max(1000).optional()}).parse(req.body);const owned=await prisma.timetable.findFirst({where:{teacherId:teacher.id,batchId:input.batchId}});const student=await prisma.studentProfile.findFirst({where:{userId:input.studentUserId,batchId:input.batchId,branchId:teacher.branchId}});if(!owned||!student)throw new AppError(403,"CLASS_ACCESS_DENIED","Teacher is not assigned to this student's class");const data=await prisma.attendance.upsert({where:{studentId_batchId_date:{studentId:input.studentUserId,batchId:input.batchId,date:input.date}},create:{...input,studentId:input.studentUserId,teacherId:teacher.id,markedById:id(req)},update:{status:input.status,remarks:input.remarks,teacherId:teacher.id,markedById:id(req)}});res.status(201).json({data});});

async function mayAccessStudent(req: AuthRequest, studentId: string) {
  if (req.auth!.role === Role.STUDENT) return Boolean(await prisma.studentProfile.findFirst({ where: { id: studentId, userId: id(req) } }));
  if (req.auth!.role === Role.PARENT) return Boolean(await prisma.parentStudent.findUnique({ where: { parentId_studentId: { parentId: id(req), studentId } } }));
  const teacher = await teacherForUser(id(req)); const student = teacher && await prisma.studentProfile.findUnique({ where: { id: studentId }, select: { branchId: true } }); return Boolean(teacher && student?.branchId === teacher.branchId);
}
router.get("/downloads/homework/:homeworkId", async (req: AuthRequest, res) => { const homework=await prisma.homework.findUnique({where:{id:String(req.params.homeworkId)},select:{batchId:true,teacherId:true,attachmentData:true,attachmentName:true,attachmentMime:true}});if(!homework?.attachmentData)throw new AppError(404,"ATTACHMENT_NOT_FOUND","Attachment not found");if(req.auth!.role===Role.STUDENT){const student=await studentForUser(id(req));if(student?.batchId!==homework.batchId)throw new AppError(403,"FORBIDDEN","Download access denied");}else if(req.auth!.role===Role.PARENT){const linked=await prisma.parentStudent.findFirst({where:{parentId:id(req),student:{batchId:homework.batchId}}});if(!linked)throw new AppError(403,"FORBIDDEN","Download access denied");}else{const teacher=await teacherForUser(id(req));if(teacher?.id!==homework.teacherId)throw new AppError(403,"FORBIDDEN","Download access denied");}res.set({"Content-Type":homework.attachmentMime!,"Content-Disposition":`attachment; filename="${homework.attachmentName!.replace(/["\r\n]/g,"")}"`}).send(Buffer.from(homework.attachmentData));});
router.get("/downloads/certificate/:certificateId", async (req: AuthRequest, res) => { const c=await prisma.certificate.findUnique({where:{id:String(req.params.certificateId)},include:{student:{include:{user:true,batch:{include:{course:true}}}}}});if(!c||c.status==="DRAFT")throw new AppError(404,"CERTIFICATE_NOT_FOUND","Issued certificate not found");if(!(await mayAccessStudent(req,c.studentId)))throw new AppError(403,"FORBIDDEN","Download access denied");sendPdf(res,`${c.type.replaceAll("_"," ")} CERTIFICATE`,[`Certificate No: ${c.certificateNumber}`,`Student: ${c.student.user.name}`,`Admission: ${c.student.admissionNo}`,`Course: ${c.student.batch.course?.title??"N/A"}`,`Purpose: ${c.purpose}`,`Issued: ${c.issueDate?.toISOString().slice(0,10)??"N/A"}`],`${c.certificateNumber}.pdf`);});
router.get("/downloads/report-card/:resultId", async (req: AuthRequest, res) => { const r=await prisma.examinationResult.findUnique({where:{id:String(req.params.resultId)},include:{student:{include:{user:true,batch:{include:{course:true}}}},examination:{include:{subject:true}}}});if(!r)throw new AppError(404,"RESULT_NOT_FOUND","Result not found");if(!(await mayAccessStudent(req,r.studentId)))throw new AppError(403,"FORBIDDEN","Download access denied");sendPdf(res,"STUDENT REPORT CARD",[`Student: ${r.student.user.name}`,`Admission: ${r.student.admissionNo} | Roll: ${r.student.rollNo}`,`Course: ${r.student.batch.course?.title??"N/A"}`,`Examination: ${r.examination.name} | Subject: ${r.examination.subject.name}`,`Marks: ${r.marksObtained??"Absent"}/${r.examination.maximumMarks}`,`Percentage: ${r.percentage??"-"}% | Grade: ${r.grade??"-"} | GPA: ${r.gpa??"-"}`,`Rank: ${r.rank??"-"} | Result: ${r.status}`],"report-card.pdf");});
function sendPdf(res:any,title:string,lines:string[],filename:string){const content=[title,...lines].map((x,i)=>`BT /F1 ${i?11:18} Tf 45 ${790-i*35} Td (${x.replace(/[()\\]/g,"\\$&")}) Tj ET`).join("\n"),objects=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];let pdf="%PDF-1.4\n",offsets=[0];objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`});const at=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(x=>String(x).padStart(10,"0")+" 00000 n ").join("\n")}\ntrailer << /Size 6 /Root 1 0 R >>\nstartxref\n${at}\n%%EOF`;res.set({"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="${filename.replace(/["\r\n]/g,"")}"`}).send(Buffer.from(pdf));}

export default router;
