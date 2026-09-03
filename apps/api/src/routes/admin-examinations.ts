import { ExaminationResultStatus, ExaminationStatus, ExaminationType, Prisma, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/http.js";
import { assertExaminationHistoricalFieldsEditable, assertExaminationStatusTransition, assertSingleConditionalMutation, changesCoreExaminationField } from "../lib/examination-policy.js";
import { prisma } from "../lib/prisma.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN));
const serializable = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const input = z.object({
  name: z.string().trim().min(3).max(200),
  code: z.string().trim().toUpperCase().min(3).max(50).regex(/^[A-Z0-9-]+$/),
  type: z.nativeEnum(ExaminationType),
  branchId: z.string().cuid(),
  courseId: z.string().cuid(),
  batchId: z.string().cuid(),
  subjectId: z.string().cuid(),
  teacherId: z.string().cuid(),
  academicSession: z.string().trim().min(4).max(30),
  examDate: z.coerce.date(),
  startTime: time,
  endTime: time,
  maximumMarks: z.number().int().positive().max(10000),
  passingMarks: z.number().int().min(0),
  status: z.nativeEnum(ExaminationStatus).default(ExaminationStatus.DRAFT),
  remarks: z.string().trim().max(2000).nullable().optional(),
});
const select = {
  id: true, name: true, code: true, type: true, academicSession: true, examDate: true, startMinute: true, endMinute: true,
  maximumMarks: true, passingMarks: true, status: true, remarks: true, createdAt: true, updatedAt: true,
  branch: { select: { id: true, branchName: true, branchCode: true } },
  course: { select: { id: true, title: true, courseCode: true } },
  batch: { select: { id: true, name: true, code: true } },
  subject: { select: { id: true, name: true, code: true } },
  teacher: { select: { id: true, employeeNo: true, user: { select: { name: true, email: true } } } },
  results: { select: { id: true, marksObtained: true, percentage: true, grade: true, gpa: true, rank: true, status: true, remarks: true, generatedAt: true, student: { select: { id: true, admissionNo: true, rollNo: true, user: { select: { name: true, email: true } } } } }, orderBy: { rank: "asc" as const } },
  _count: { select: { results: true } },
} as const;

function mins(value: string) { const [hours, minutes] = value.split(":").map(Number); return hours * 60 + minutes; }
function clock(value: number) { return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`; }
const shape = (value: any) => ({ ...value, startTime: clock(value.startMinute), endTime: clock(value.endMinute), branch: { ...value.branch, name: value.branch.branchName, code: value.branch.branchCode } });
const auditData = (req: AuthRequest, action: string, entityId: string) => ({ organizationId: req.auth!.organizationId, actorId: req.auth!.userId, action, entity: "Examination", entityId });

async function scope(req: AuthRequest) {
  if (req.auth!.role !== Role.BRANCH_ADMIN) return null;
  return (await prisma.branchUser.findMany({ where: { userId: req.auth!.userId }, select: { branchId: true } })).map(value => value.branchId);
}
async function access(req: AuthRequest, branchId: string) {
  const allowed = await scope(req);
  if (allowed && !allowed.includes(branchId)) throw new AppError(403, "BRANCH_FORBIDDEN", "Branch access denied");
}

async function validate(data: z.infer<typeof input>, exclude?: string) {
  const startMinute = mins(data.startTime), endMinute = mins(data.endTime);
  if (endMinute <= startMinute) throw new AppError(422, "INVALID_TIME_RANGE", "End time must be after start time");
  if (data.passingMarks > data.maximumMarks) throw new AppError(422, "PASSING_MARKS_EXCEED_MAXIMUM", "Passing marks cannot exceed maximum marks");
  const [batch, subject, teacher] = await Promise.all([
    prisma.batch.findUnique({ where: { id: data.batchId }, select: { branchId: true, courseId: true, academicSession: true, academicSessionId: true } }),
    prisma.courseSubject.findUnique({ where: { courseId_subjectId: { courseId: data.courseId, subjectId: data.subjectId } }, select: { isActive: true } }),
    prisma.teacherProfile.findUnique({ where: { id: data.teacherId }, select: { branchId: true } }),
  ]);
  if (!batch || batch.branchId !== data.branchId || batch.courseId !== data.courseId || batch.academicSession !== data.academicSession) throw new AppError(422, "INVALID_BATCH_RELATION", "Batch must match Branch, Course and Academic Session");
  if (!subject?.isActive) throw new AppError(422, "INVALID_SUBJECT_RELATION", "Subject must belong to Course");
  if (!teacher || teacher.branchId !== data.branchId) throw new AppError(422, "INVALID_TEACHER_RELATION", "Teacher must belong to Branch");
  const examDate = new Date(data.examDate); examDate.setUTCHours(0, 0, 0, 0);
  const conflict = await prisma.examination.findFirst({ where: { examDate, status: { not: ExaminationStatus.ARCHIVED }, startMinute: { lt: endMinute }, endMinute: { gt: startMinute }, OR: [{ batchId: data.batchId }, { teacherId: data.teacherId }], ...(exclude ? { id: { not: exclude } } : {}) }, select: { batchId: true, teacherId: true } });
  if (conflict) throw new AppError(409, conflict.batchId === data.batchId ? "BATCH_EXAM_CONFLICT" : "TEACHER_EXAM_CONFLICT", "An examination overlaps this Batch or Teacher schedule");
  return { startMinute, endMinute, examDate, academicSessionId: batch.academicSessionId };
}

async function activity(client: Prisma.TransactionClient, examinationId: string, organizationId: string) {
  const [publishedQuestionPapers, answerSheets, results] = await Promise.all([
    client.examinationQuestionPaper.count({ where: { organizationId, examinationId, publishedAt: { not: null } } }),
    client.examinationAnswerSheet.count({ where: { organizationId, examinationId } }),
    client.examinationResult.count({ where: { organizationId, examinationId } }),
  ]);
  return { publishedQuestionPapers, answerSheets, results };
}

async function assertPublishable(client: Prisma.TransactionClient, examinationId: string, organizationId: string) {
  const [results, unfinished] = await Promise.all([
    client.examinationResult.count({ where: { organizationId, examinationId } }),
    client.examinationAnswerSheet.count({ where: { organizationId, examinationId, finalizedAt: null } }),
  ]);
  if (!results) throw new AppError(409, "RESULTS_REQUIRED", "Generate or finalize examination results before publication");
  if (unfinished) throw new AppError(409, "EVALUATIONS_INCOMPLETE", "All submitted answer sheets must be finalized before result publication");
}

router.get("/examinations/options", async (req: AuthRequest, res) => {
  const ids = await scope(req);
  const [branches, batches, teachers, subjects, students] = await Promise.all([
    prisma.branch.findMany({ where: ids ? { id: { in: ids } } : {}, select: { id: true, branchName: true, branchCode: true } }),
    prisma.batch.findMany({ where: ids ? { branchId: { in: ids } } : {}, select: { id: true, name: true, code: true, branchId: true, courseId: true, academicSession: true, course: { select: { title: true } } } }),
    prisma.teacherProfile.findMany({ where: ids ? { branchId: { in: ids } } : {}, select: { id: true, branchId: true, user: { select: { name: true } } } }),
    prisma.courseSubject.findMany({ where: { isActive: true }, select: { courseId: true, subject: { select: { id: true, name: true, code: true } } } }),
    prisma.studentProfile.findMany({ where: ids ? { branchId: { in: ids } } : {}, select: { id: true, batchId: true, admissionNo: true, rollNo: true, user: { select: { name: true } } } }),
  ]);
  res.json({ data: { branches: branches.map(value => ({ ...value, name: value.branchName, code: value.branchCode })), batches, teachers, subjects, students } });
});

router.get("/examinations/dashboard", async (req: AuthRequest, res) => {
  const ids = await scope(req), where = ids ? { branchId: { in: ids } } : {};
  const [total, scheduled, completed, published, archived, results] = await Promise.all([
    prisma.examination.count({ where }),
    prisma.examination.count({ where: { ...where, status: ExaminationStatus.SCHEDULED } }),
    prisma.examination.count({ where: { ...where, status: ExaminationStatus.COMPLETED } }),
    prisma.examination.count({ where: { ...where, status: ExaminationStatus.RESULTS_PUBLISHED } }),
    prisma.examination.count({ where: { ...where, status: ExaminationStatus.ARCHIVED } }),
    prisma.examinationResult.count({ where: { examination: where } }),
  ]);
  res.json({ data: { total, scheduled, completed, published, archived, results } });
});

router.get("/examinations/export", async (req: AuthRequest, res) => {
  const format = z.enum(["excel", "pdf"]).parse(req.query.format), ids = await scope(req);
  const data = await prisma.examination.findMany({ where: ids ? { branchId: { in: ids } } : {}, select, orderBy: { examDate: "asc" } });
  const rows = data.flatMap((exam: any) => exam.results.length ? exam.results.map((result: any) => [exam.code, exam.name, exam.batch.name, exam.subject.name, exam.examDate.toISOString().slice(0, 10), result.student.admissionNo, result.student.user.name, result.marksObtained ?? "", result.percentage ?? "", result.grade ?? "", result.gpa ?? "", result.rank ?? "", result.status]) : [[exam.code, exam.name, exam.batch.name, exam.subject.name, exam.examDate.toISOString().slice(0, 10), "", "", "", "", "", "", "", exam.status]]);
  if (format === "pdf") return pdf(res, "EXAMINATION RESULTS", rows.map(value => value.join(" | ")));
  const all = [["Code", "Exam", "Batch", "Subject", "Date", "Admission", "Student", "Marks", "Percentage", "Grade", "GPA", "Rank", "Status"], ...rows];
  const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Results"><Table>${all.map(row => `<Row>${row.map((value: any) => `<Cell><Data ss:Type="String">${esc(String(value))}</Data></Cell>`).join("")}</Row>`).join("")}</Table></Worksheet></Workbook>`;
  res.set({ "Content-Type": "application/vnd.ms-excel", "Content-Disposition": "attachment; filename=examination-results.xls" }).send(xml);
});

router.get("/examinations", async (req: AuthRequest, res) => {
  const query = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20), search: z.string().trim().optional(), branchId: z.string().cuid().optional(), courseId: z.string().cuid().optional(), batchId: z.string().cuid().optional(), subjectId: z.string().cuid().optional(), teacherId: z.string().cuid().optional(), type: z.nativeEnum(ExaminationType).optional(), status: z.nativeEnum(ExaminationStatus).optional(), academicSession: z.string().optional(), sortBy: z.enum(["name", "code", "examDate", "startMinute", "maximumMarks", "status", "createdAt"]).default("examDate"), sortOrder: z.enum(["asc", "desc"]).default("asc") }).parse(req.query);
  const ids = await scope(req);
  const where = { ...(ids ? { branchId: { in: ids } } : {}), ...(query.branchId ? { branchId: query.branchId } : {}), ...(query.courseId ? { courseId: query.courseId } : {}), ...(query.batchId ? { batchId: query.batchId } : {}), ...(query.subjectId ? { subjectId: query.subjectId } : {}), ...(query.teacherId ? { teacherId: query.teacherId } : {}), ...(query.type ? { type: query.type } : {}), ...(query.status ? { status: query.status } : {}), ...(query.academicSession ? { academicSession: query.academicSession } : {}), ...(query.search ? { OR: [{ name: { contains: query.search, mode: "insensitive" as const } }, { code: { contains: query.search, mode: "insensitive" as const } }, { batch: { name: { contains: query.search, mode: "insensitive" as const } } }, { subject: { name: { contains: query.search, mode: "insensitive" as const } } }] } : {}) };
  const [total, data] = await prisma.$transaction([prisma.examination.count({ where }), prisma.examination.findMany({ where, select, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: { [query.sortBy]: query.sortOrder } })]);
  res.json({ data: data.map(shape), meta: { total, page: query.page, limit: query.limit, totalPages: Math.max(1, Math.ceil(total / query.limit)) } });
});

router.get("/examinations/:id", async (req: AuthRequest, res) => {
  const value = await prisma.examination.findUnique({ where: { id: String(req.params.id) }, select });
  if (!value) throw new AppError(404, "EXAMINATION_NOT_FOUND", "Examination not found");
  await access(req, value.branch.id);
  res.json({ data: shape(value) });
});

router.post("/examinations", async (req: AuthRequest, res) => {
  const data = input.parse(req.body);
  if (data.status !== ExaminationStatus.DRAFT) throw new AppError(409, "INVALID_EXAMINATION_STATUS_TRANSITION", "New examinations must begin in DRAFT status");
  await access(req, data.branchId);
  const normalized = await validate(data), { startTime, endTime, ...rest } = data;
  try {
    const created = await prisma.$transaction(async tx => {
      const value = await tx.examination.create({ data: { organizationId: req.auth!.organizationId, ...rest, ...normalized }, select });
      await tx.auditLog.create({ data: auditData(req, "CREATE", value.id) });
      return value;
    });
    res.status(201).json({ data: shape(created) });
  } catch (error: any) {
    if (error.code === "P2002") throw new AppError(409, "DUPLICATE_EXAMINATION", "Exam Code or Batch/Subject/Exam Type already exists");
    throw error;
  }
});

router.patch("/examinations/:id", async (req: AuthRequest, res) => {
  const old = await prisma.examination.findUnique({ where: { id: String(req.params.id) }, select: { id: true, name: true, code: true, type: true, branchId: true, courseId: true, batchId: true, subjectId: true, teacherId: true, academicSession: true, examDate: true, startMinute: true, endMinute: true, maximumMarks: true, passingMarks: true, status: true, remarks: true } });
  if (!old) throw new AppError(404, "EXAMINATION_NOT_FOUND", "Examination not found");
  await access(req, old.branchId);
  const partial = input.partial().parse(req.body);
  if (partial.branchId) await access(req, partial.branchId);
  if (partial.status) assertExaminationStatusTransition(old.status, partial.status);
  const merged: any = { ...old, startTime: clock(old.startMinute), endTime: clock(old.endMinute), ...partial };
  const normalized = await validate(merged, old.id), { startTime, endTime, ...rest } = partial;
  try {
    const updated = await prisma.$transaction(async tx => {
      const locked = await tx.examination.updateMany({ where: { id: old.id, organizationId: req.auth!.organizationId, status: old.status }, data: { updatedAt: new Date() } });
      assertSingleConditionalMutation(locked.count, "EXAMINATION_CHANGED", "Examination changed concurrently; reload before editing");
      if (changesCoreExaminationField(partial, { ...old, startTime: clock(old.startMinute), endTime: clock(old.endMinute) })) {
        assertExaminationHistoricalFieldsEditable(await activity(tx, old.id, req.auth!.organizationId));
      }
      if (partial.status === ExaminationStatus.RESULTS_PUBLISHED) await assertPublishable(tx, old.id, req.auth!.organizationId);
      const value = await tx.examination.update({ where: { id: old.id }, data: { ...rest, ...normalized }, select });
      await tx.auditLog.create({ data: auditData(req, partial.status === ExaminationStatus.ARCHIVED ? "ARCHIVE" : partial.status === ExaminationStatus.RESULTS_PUBLISHED ? "PUBLISH" : "UPDATE", value.id) });
      return value;
    }, serializable);
    res.json({ data: shape(updated) });
  } catch (error: any) {
    if (error.code === "P2002") throw new AppError(409, "DUPLICATE_EXAMINATION", "Exam Code or Batch/Subject/Exam Type already exists");
    throw error;
  }
});

router.post("/examinations/:id/marks", async (req: AuthRequest, res) => {
  const exam = await prisma.examination.findUnique({ where: { id: String(req.params.id) }, select: { id: true, batchId: true, maximumMarks: true, status: true } });
  if (!exam) throw new AppError(404, "EXAMINATION_NOT_FOUND", "Examination not found");
  if (exam.status !== ExaminationStatus.COMPLETED) throw new AppError(409, "MARKS_ENTRY_UNAVAILABLE", "Legacy marks entry is allowed only for completed examinations");
  const rows = z.array(z.object({ studentId: z.string().cuid(), marksObtained: z.number().min(0).nullable(), status: z.nativeEnum(ExaminationResultStatus).optional(), remarks: z.string().max(1000).nullable().optional() })).min(1).max(500).parse(req.body.results);
  for (const row of rows) {
    const student = await prisma.studentProfile.findUnique({ where: { id: row.studentId }, select: { batchId: true } });
    if (!student || student.batchId !== exam.batchId) throw new AppError(422, "INVALID_STUDENT_BATCH", "Every student must belong to the examination Batch");
    if (row.marksObtained !== null && row.marksObtained > exam.maximumMarks) throw new AppError(422, "MARKS_EXCEED_MAXIMUM", "Marks cannot exceed Maximum Marks");
  }
  const data = await prisma.$transaction(async tx => {
    const locked = await tx.examination.updateMany({ where: { id: exam.id, organizationId: req.auth!.organizationId, status: ExaminationStatus.COMPLETED }, data: { updatedAt: new Date() } });
    assertSingleConditionalMutation(locked.count, "MARKS_ENTRY_UNAVAILABLE", "Examination is no longer open for marks entry");
    if (await tx.examinationAnswerSheet.count({ where: { organizationId: req.auth!.organizationId, examinationId: exam.id } })) throw new AppError(409, "ANSWER_SHEET_RESULTS_AUTHORITATIVE", "Use answer-sheet evaluation when submissions exist");
    const values = [];
    for (const row of rows) values.push(await tx.examinationResult.upsert({ where: { examinationId_studentId: { examinationId: exam.id, studentId: row.studentId } }, update: { marksObtained: row.marksObtained, status: row.status ?? (row.marksObtained === null ? ExaminationResultStatus.ABSENT : undefined), remarks: row.remarks }, create: { organizationId: req.auth!.organizationId, examinationId: exam.id, studentId: row.studentId, marksObtained: row.marksObtained, status: row.status ?? (row.marksObtained === null ? ExaminationResultStatus.ABSENT : ExaminationResultStatus.PASS), remarks: row.remarks } }));
    await tx.auditLog.create({ data: auditData(req, "ENTER_MARKS", exam.id) });
    return values;
  }, serializable);
  res.json({ data });
});

router.post("/examinations/:id/generate-results", async (req: AuthRequest, res) => {
  const exam = await prisma.examination.findUnique({ where: { id: String(req.params.id) }, select: { id: true, batchId: true, maximumMarks: true, passingMarks: true, status: true } });
  if (!exam) throw new AppError(404, "EXAMINATION_NOT_FOUND", "Examination not found");
  if (exam.status !== ExaminationStatus.COMPLETED) throw new AppError(409, "RESULT_GENERATION_UNAVAILABLE", "Results can be generated only once for a completed examination");
  const data = await prisma.$transaction(async tx => {
    const locked = await tx.examination.updateMany({ where: { id: exam.id, organizationId: req.auth!.organizationId, status: ExaminationStatus.COMPLETED }, data: { updatedAt: new Date() } });
    assertSingleConditionalMutation(locked.count, "RESULT_GENERATION_UNAVAILABLE", "Examination is no longer open for result generation");
    if (await tx.examinationAnswerSheet.count({ where: { organizationId: req.auth!.organizationId, examinationId: exam.id } })) throw new AppError(409, "ANSWER_SHEET_RESULTS_AUTHORITATIVE", "Publish finalized answer-sheet results through the examination status workflow");
    const students = await tx.studentProfile.findMany({ where: { batchId: exam.batchId }, select: { id: true } });
    for (const student of students) await tx.examinationResult.upsert({ where: { examinationId_studentId: { examinationId: exam.id, studentId: student.id } }, update: {}, create: { organizationId: req.auth!.organizationId, examinationId: exam.id, studentId: student.id, status: ExaminationResultStatus.ABSENT } });
    const results = await tx.examinationResult.findMany({ where: { examinationId: exam.id }, orderBy: { marksObtained: "desc" } });
    let rank = 0, last: number | null = null, index = 0;
    const generatedAt = new Date();
    for (const result of results) {
      index++;
      if (result.marksObtained === null) {
        await tx.examinationResult.update({ where: { id: result.id }, data: { percentage: null, grade: null, gpa: null, rank: null, status: ExaminationResultStatus.ABSENT, generatedAt } });
        continue;
      }
      const marks = Number(result.marksObtained), percentage = marks / exam.maximumMarks * 100, calculated = grade(percentage);
      if (last === null || marks < last) rank = index;
      last = marks;
      await tx.examinationResult.update({ where: { id: result.id }, data: { percentage, grade: calculated.grade, gpa: calculated.gpa, rank, status: marks >= exam.passingMarks ? ExaminationResultStatus.PASS : ExaminationResultStatus.FAIL, generatedAt } });
    }
    const value = await tx.examination.update({ where: { id: exam.id }, data: { status: ExaminationStatus.RESULTS_PUBLISHED }, select });
    await tx.auditLog.create({ data: auditData(req, "GENERATE_RESULTS", exam.id) });
    await tx.auditLog.create({ data: auditData(req, "PUBLISH", exam.id) });
    return value;
  }, serializable);
  res.json({ data: shape(data) });
});

router.get("/examinations/:id/report-card/:studentId", async (req, res) => {
  const result = await prisma.examinationResult.findUnique({ where: { examinationId_studentId: { examinationId: String(req.params.id), studentId: String(req.params.studentId) } }, include: { student: { include: { user: true, batch: { include: { course: true } } } }, examination: { include: { subject: true, branch: true } } } });
  if (!result) throw new AppError(404, "RESULT_NOT_FOUND", "Generated result not found");
  pdf(res, "STUDENT REPORT CARD", [`Student: ${result.student.user.name}`, `Admission: ${result.student.admissionNo} | Roll: ${result.student.rollNo}`, `Course: ${result.student.batch.course?.title} | Batch: ${result.student.batch.name}`, `Examination: ${result.examination.name} | Subject: ${result.examination.subject.name}`, `Marks: ${result.marksObtained ?? "Absent"}/${result.examination.maximumMarks}`, `Percentage: ${result.percentage ?? "-"}% | Grade: ${result.grade ?? "-"} | GPA: ${result.gpa ?? "-"}`, `Rank: ${result.rank ?? "-"} | Result: ${result.status}`]);
});

router.patch("/examinations/:id/status", async (req: AuthRequest, res) => {
  const { status } = z.object({ status: z.nativeEnum(ExaminationStatus) }).parse(req.body);
  const old = await prisma.examination.findUnique({ where: { id: String(req.params.id) }, select: { id: true, status: true } });
  if (!old) throw new AppError(404, "EXAMINATION_NOT_FOUND", "Examination not found");
  assertExaminationStatusTransition(old.status, status);
  const value = await prisma.$transaction(async tx => {
    const locked = await tx.examination.updateMany({ where: { id: old.id, organizationId: req.auth!.organizationId, status: old.status }, data: { updatedAt: new Date() } });
    assertSingleConditionalMutation(locked.count, "EXAMINATION_CHANGED", "Examination status changed concurrently; reload before retrying");
    if (status === ExaminationStatus.RESULTS_PUBLISHED) await assertPublishable(tx, old.id, req.auth!.organizationId);
    const updated = await tx.examination.update({ where: { id: old.id }, data: { status }, select });
    await tx.auditLog.create({ data: auditData(req, status === ExaminationStatus.ARCHIVED ? "ARCHIVE" : status === ExaminationStatus.RESULTS_PUBLISHED ? "PUBLISH" : "STATUS_CHANGE", old.id) });
    return updated;
  }, serializable);
  res.json({ data: shape(value) });
});

router.delete("/examinations/:id", async (req: AuthRequest, res) => {
  const exam = await prisma.examination.findUnique({ where: { id: String(req.params.id) }, select: { id: true, status: true } });
  if (!exam) throw new AppError(404, "EXAMINATION_NOT_FOUND", "Examination not found");
  if (exam.status !== ExaminationStatus.ARCHIVED) throw new AppError(409, "ARCHIVE_BEFORE_DELETE", "Archive examination before deleting it");
  await prisma.$transaction(async tx => {
    const locked = await tx.examination.updateMany({ where: { id: exam.id, organizationId: req.auth!.organizationId, status: ExaminationStatus.ARCHIVED }, data: { updatedAt: new Date() } });
    assertSingleConditionalMutation(locked.count, "EXAMINATION_CHANGED", "Examination changed concurrently; reload before deleting");
    const [results, answerSheets, paper] = await Promise.all([
      tx.examinationResult.count({ where: { organizationId: req.auth!.organizationId, examinationId: exam.id } }),
      tx.examinationAnswerSheet.count({ where: { organizationId: req.auth!.organizationId, examinationId: exam.id } }),
      tx.examinationQuestionPaper.count({ where: { organizationId: req.auth!.organizationId, examinationId: exam.id } }),
    ]);
    if (results || answerSheets || paper) throw new AppError(409, "EXAMINATION_HAS_ACTIVITY", "Examinations with papers, submissions or results cannot be deleted");
    await tx.examination.delete({ where: { id: exam.id } });
    await tx.auditLog.create({ data: auditData(req, "DELETE", exam.id) });
  }, serializable);
  res.status(204).send();
});

function grade(percentage: number) { if (percentage >= 90) return { grade: "A+", gpa: 10 }; if (percentage >= 80) return { grade: "A", gpa: 9 }; if (percentage >= 70) return { grade: "B+", gpa: 8 }; if (percentage >= 60) return { grade: "B", gpa: 7 }; if (percentage >= 50) return { grade: "C", gpa: 6 }; if (percentage >= 40) return { grade: "D", gpa: 5 }; return { grade: "F", gpa: 0 }; }
function esc(value: string) { return value.replace(/[<>&'\"]/g, character => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[character]!); }
function pdf(res: any, title: string, lines: string[]) { const content = [title, ...lines].slice(0, 45).map((value, index) => `BT /F1 ${index ? 10 : 18} Tf 35 ${800 - index * 25} Td (${value.replace(/[()\\]/g, "\\$&")}) Tj ET`).join("\n"), objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]; let document = "%PDF-1.4\n", offsets = [0]; objects.forEach((object, index) => { offsets.push(Buffer.byteLength(document)); document += `${index + 1} 0 obj\n${object}\nendobj\n`; }); const at = Buffer.byteLength(document); document += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(value => String(value).padStart(10, "0") + " 00000 n ").join("\n")}\ntrailer << /Size 6 /Root 1 0 R >>\nstartxref\n${at}\n%%EOF`; res.set({ "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=report.pdf" }).send(Buffer.from(document)); }

export default router;
