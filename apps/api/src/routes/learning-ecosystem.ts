import { ApprovalStatus, DoubtStatus, LearningAttemptStatus, LearningStatus, LearningTestType, LiveClassProvider, QuestionType, Role, StudyMaterialType } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config.js";
import {
  assertLearnerContentAccess,
  assertManagerQuestionAccess,
  assertManagerResourceAccess,
  assertStudentHasSubject,
  assertStudentTargetAccess,
  learningActorForRequest,
  learningAttemptStudentWhere,
  learningDenied,
  learningDoubtWhere,
  learningQuestionWhere,
  learningResourceWhere,
  type LearningActor,
  type LearningResource,
} from "../lib/learning-ecosystem-access.js";
import { AppError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);
router.use(allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN, Role.TEACHER, Role.STUDENT, Role.PARENT));
const managers = allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN, Role.TEACHER);
const pageQuery = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20), search: z.string().trim().max(100).optional(), sortOrder: z.enum(["asc", "desc"]).default("desc") });
const id = z.string().cuid();
const fileInput = z.object({ name: z.string().min(1).max(180), mimeType: z.string().min(3).max(100), base64: z.string().min(1) });
const questionTypes = z.nativeEnum(QuestionType);
const audit = (req: AuthRequest, action: string, entity: string, entityId?: string, metadata?: unknown) => prisma.auditLog.create({ data: { actorId: req.auth!.userId, action, entity, entityId, metadata: metadata as object | undefined } });
const notify = (userId: string, title: string, body: string, sourceModule = "LEARNING_ECOSYSTEM", sourceEntityId?: string, actionUrl = "/learning-hub") => prisma.notification.create({ data: { userId, title, body, sourceModule, sourceEntityId, actionUrl, channels: ["IN_APP"] } });
function decodeFile(file: z.infer<typeof fileInput>, max = 10 * 1024 * 1024, types?: string[]) { const data = Buffer.from(file.base64.replace(/^data:[^;]+;base64,/, ""), "base64"); if (!data.length || data.length > max) throw new AppError(422, "INVALID_FILE_SIZE", `File must be smaller than ${Math.round(max / 1048576)} MB`); if (types && !types.includes(file.mimeType)) throw new AppError(422, "INVALID_FILE_TYPE", "File type is not allowed"); return data; }
async function relationCheck(data: { courseId?: string | null; batchId?: string | null; subjectId?: string | null; branchId?: string | null; teacherId?: string | null }) {
  const [course, batch, subject, teacher] = await Promise.all([data.courseId ? prisma.course.findUnique({ where: { id: data.courseId }, select: { id: true, branchId: true } }) : null, data.batchId ? prisma.batch.findUnique({ where: { id: data.batchId }, select: { id: true, courseId: true, branchId: true } }) : null, data.subjectId ? prisma.subject.findUnique({ where: { id: data.subjectId }, select: { id: true } }) : null, data.teacherId ? prisma.teacherProfile.findUnique({ where: { id: data.teacherId }, select: { id: true, userId: true, branchId: true } }) : null]);
  if (data.courseId && !course) throw new AppError(422, "INVALID_COURSE", "Course does not exist");
  if (data.courseId && data.branchId && course?.branchId && course.branchId !== data.branchId) throw new AppError(422, "INVALID_COURSE_RELATION", "Course must match Branch");
  if (data.batchId && (!batch || (data.courseId && batch.courseId !== data.courseId) || (data.branchId && batch.branchId !== data.branchId))) throw new AppError(422, "INVALID_BATCH_RELATION", "Batch must match Course and Branch");
  if (data.subjectId && !subject) throw new AppError(422, "INVALID_SUBJECT", "Subject does not exist");
  if (data.teacherId && (!teacher || (data.branchId && teacher.branchId !== data.branchId))) throw new AppError(422, "INVALID_TEACHER", "Teacher must match Branch");
  if (data.courseId && data.subjectId && !await prisma.courseSubject.findUnique({ where: { courseId_subjectId: { courseId: data.courseId, subjectId: data.subjectId } } })) throw new AppError(422, "INVALID_SUBJECT_RELATION", "Subject is not assigned to Course");
  return { course, batch, subject, teacher, teacherUserId: teacher?.userId };
}

router.get("/learning/options", async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const superAdmin = actor.role === Role.SUPER_ADMIN;
  const learner = actor.role === Role.STUDENT || actor.role === Role.PARENT;
  const batchIds = actor.role === Role.TEACHER
    ? [...new Set(actor.allocations.map(row => row.batchId))]
    : actor.learners.map(row => row.batchId);
  const subjectIds = actor.role === Role.TEACHER
    ? [...new Set(actor.allocations.map(row => row.subjectId).filter((value): value is string => Boolean(value)))]
    : [];
  const [branches, courses, batches, subjects, teachers, students] = await Promise.all([
    prisma.branch.findMany({ where: { isActive: true, ...(superAdmin ? {} : { id: { in: actor.branchIds } }) }, select: { id: true, branchName: true } }),
    prisma.course.findMany({ where: superAdmin ? {} : { id: { in: actor.courseIds } }, select: { id: true, title: true, branchId: true } }),
    prisma.batch.findMany({
      where: superAdmin ? {} : actor.role === Role.BRANCH_ADMIN ? { branchId: { in: actor.branchIds } } : { id: { in: batchIds } },
      select: { id: true, name: true, courseId: true, branchId: true },
    }),
    prisma.subject.findMany({
      where: superAdmin ? {} : actor.role === Role.TEACHER
        ? { id: { in: subjectIds } }
        : { courses: { some: { courseId: { in: actor.courseIds }, isActive: true } } },
      select: { id: true, name: true },
    }),
    prisma.teacherProfile.findMany({
      where: superAdmin ? {} : actor.role === Role.BRANCH_ADMIN
        ? { branchId: { in: actor.branchIds } }
        : actor.role === Role.TEACHER ? { id: actor.teacherProfileId ?? { in: [] } } : { id: { in: [] } },
      select: { id: true, userId: true, branchId: true, user: { select: { name: true } } },
    }),
    prisma.studentProfile.findMany({
      where: superAdmin ? {} : actor.role === Role.BRANCH_ADMIN
        ? { branchId: { in: actor.branchIds } }
        : actor.role === Role.TEACHER ? { batchId: { in: batchIds } }
          : learner ? { userId: { in: actor.learners.map(row => row.userId) } } : { id: { in: [] } },
      select: { userId: true, batchId: true, user: { select: { name: true } } },
    }),
  ]);
  res.json({ data: { branches: branches.map(row => ({ id: row.id, name: row.branchName })), courses, batches, subjects, teachers, students } });
});

router.get("/learning/dashboard", async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const userId = actor.userId, role = actor.role;
  const audience = role === Role.STUDENT || role === Role.PARENT ? actor.learners.map(row => row.userId) : undefined;
  const doubtScope = role === Role.PARENT
    ? { studentId: { in: audience ?? [] } }
    : learningDoubtWhere(actor);
  const questionScope = role === Role.STUDENT || role === Role.PARENT
    ? { courseId: { in: actor.courseIds } }
    : learningQuestionWhere(actor);
  const contentScope = learningResourceWhere(actor);
  const classScope = learningResourceWhere(actor, { teacherOwned: role === Role.TEACHER });
  const attemptScope = learningAttemptStudentWhere(actor);
  const [doubts, questions, tests, materials, classes, attempts, recommendations, goals, game, fees, homework, attendance] = await Promise.all([
    prisma.doubtThread.count({ where: doubtScope }),
    prisma.questionBankItem.count({ where: { ...questionScope, approvalStatus: ApprovalStatus.APPROVED, isArchived: false } }),
    prisma.learningTest.count({ where: { ...contentScope, ...(audience ? { status: LearningStatus.PUBLISHED } : {}) } }),
    prisma.studyMaterial.count({ where: { ...contentScope, ...(audience ? { status: LearningStatus.PUBLISHED } : {}), isArchived: false } }),
    prisma.liveClass.count({ where: { ...classScope, ...(audience ? { status: LearningStatus.PUBLISHED } : {}), endsAt: { gte: new Date() } } }),
    prisma.learningTestAttempt.findMany({ where: { ...attemptScope, test: contentScope, status: LearningAttemptStatus.EVALUATED }, select: { score: true, percentage: true, submittedAt: true }, take: 20, orderBy: { submittedAt: "desc" } }),
    audience ? prisma.learningRecommendation.findMany({ where: { userId: { in: audience }, completedAt: null }, take: 10, orderBy: { priority: "desc" } }) : [], audience ? prisma.dailyLearningGoal.findMany({ where: { userId: { in: audience } }, take: 7, orderBy: { date: "desc" } }) : [], role === Role.STUDENT ? prisma.gamificationProfile.findUnique({ where: { userId } }) : null,
    role === Role.STUDENT ? prisma.fee.findMany({ where: { student: { userId } }, select: { status: true, totalPaise: true, amountPaidPaise: true }, take: 20 }) : [], role === Role.STUDENT ? prisma.homework.findMany({ where: { batch: { students: { some: { userId } } } }, select: { id: true, title: true, dueDate: true, status: true }, take: 10, orderBy: { dueDate: "asc" } }) : [], role === Role.STUDENT ? prisma.attendance.findMany({ where: { studentId: userId }, select: { status: true, date: true }, take: 30, orderBy: { date: "desc" } }) : []
  ]);
  const average = attempts.length ? Math.round(attempts.reduce((sum, x) => sum + Number(x.percentage ?? 0), 0) / attempts.length) : 0;
  res.json({ data: { role, counts: { doubts, approvedQuestions: questions, publishedTests: tests, studyMaterials: materials, upcomingClasses: classes }, performance: { average, attempts }, recommendations, goals, gamification: game, fees, homework, attendance } });
});

const doubtInput = z.object({ title: z.string().trim().min(3).max(180), message: z.string().trim().min(3).max(8000), subjectId: id.optional(), chapter: z.string().trim().max(150).optional(), topic: z.string().trim().max(150).optional(), attachment: fileInput.optional() });
async function contextualAnswer(data: z.infer<typeof doubtInput>, history: Array<{ role: string; content: string }>, learner?: { courseId: string; batchId: string }) {
  const contexts = data.subjectId ? await prisma.lesson.findMany({ where: { subjectId: data.subjectId, ...(learner ? { courseId: learner.courseId, batchId: learner.batchId } : {}), ...(data.chapter ? { chapter: { contains: data.chapter, mode: "insensitive" } } : {}), status: "PUBLISHED" }, select: { title: true, notes: true, description: true }, take: 5 }) : [];
  const context = contexts.map(x => `${x.title}: ${x.notes ?? x.description ?? ""}`).join("\n").slice(0, 12000);
  if (env.AI_PROVIDER_URL && env.AI_API_KEY) { try { const response = await fetch(env.AI_PROVIDER_URL, { method: "POST", headers: { Authorization: `Bearer ${env.AI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: env.AI_MODEL, messages: [{ role: "system", content: `You are a CBSE/JEE/NEET/CUET tutor. Explain step-by-step, be accurate, and say when uncertain. Context:\n${context}` }, ...history.map(x => ({ role: x.role === "AI" ? "assistant" : "user", content: x.content })), { role: "user", content: data.message }], temperature: 0.2 }) }); const json: any = await response.json(); const content = json.choices?.[0]?.message?.content; if (response.ok && content) return { content: String(content), confidence: context ? 0.9 : 0.75, sources: contexts.map(x => x.title) }; } catch { /* deterministic fallback below */ } }
  const content = context ? `Let's solve this using your course material.\n\n${context.slice(0, 1800)}\n\nFor your question: ${data.message}\n\nBreak the problem into known values, identify the governing concept, apply it step-by-step, and verify units/signs. If this does not match the expected answer, escalate it to your teacher with the attempted steps.` : `I can help structure this doubt: ${data.message}\n\n1. Write the known information.\n2. Identify the chapter concept or formula.\n3. Solve one step at a time and verify the result.\n\nNo matching academy context was found, so teacher verification is recommended.`;
  return { content, confidence: context ? 0.72 : 0.42, sources: contexts.map(x => x.title) };
}
router.get("/learning/doubts", async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const q = pageQuery.extend({ status: z.nativeEnum(DoubtStatus).optional(), bookmarked: z.coerce.boolean().optional() }).parse(req.query);
  const where: any = { ...learningDoubtWhere(actor), ...(q.status ? { status: q.status } : {}), ...(q.bookmarked !== undefined ? { bookmarked: q.bookmarked } : {}), ...(q.search ? { OR: [{ title: { contains: q.search, mode: "insensitive" } }, { chapter: { contains: q.search, mode: "insensitive" } }] } : {}) };
  const [total, data] = await prisma.$transaction([
    prisma.doubtThread.count({ where }),
    prisma.doubtThread.findMany({ where, include: { messages: { select: { id: true, authorId: true, role: true, content: true, attachmentName: true, attachmentMime: true, confidence: true, sources: true, createdAt: true }, orderBy: { createdAt: "asc" } }, student: { select: { name: true } }, assignedTeacher: { select: { name: true } } }, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { updatedAt: q.sortOrder } }),
  ]);
  res.json({ data, meta: { total, page: q.page, limit: q.limit, totalPages: Math.max(1, Math.ceil(total / q.limit)) } });
});

router.post("/learning/doubts", allow(Role.STUDENT), async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const learner = actor.learners[0];
  if (!learner) throw learningDenied();
  const d = doubtInput.parse(req.body);
  if (d.subjectId) await assertStudentHasSubject(actor, learner.courseId, d.subjectId);
  const attachment = d.attachment ? decodeFile(d.attachment, 8 * 1048576, ["image/jpeg", "image/png", "image/webp", "application/pdf"]) : null;
  const answer = await contextualAnswer(d, [], learner);
  const thread = await prisma.doubtThread.create({ data: { studentId: actor.userId, subjectId: d.subjectId, chapter: d.chapter, topic: d.topic, title: d.title, confidence: answer.confidence, status: answer.confidence >= .65 ? DoubtStatus.ANSWERED : DoubtStatus.OPEN, messages: { create: [{ authorId: actor.userId, role: "STUDENT", content: d.message, ...(attachment ? { attachmentName: d.attachment!.name, attachmentMime: d.attachment!.mimeType, attachmentData: attachment } : {}) }, { role: "AI", content: answer.content, confidence: answer.confidence, sources: answer.sources }] } }, include: { messages: { select: { id: true, authorId: true, role: true, content: true, attachmentName: true, attachmentMime: true, confidence: true, sources: true, createdAt: true } } } });
  await Promise.all([audit(req, "CREATE", "DoubtThread", thread.id), prisma.gamificationProfile.upsert({ where: { userId: actor.userId }, update: { xp: { increment: 2 } }, create: { userId: actor.userId, xp: 2 } })]);
  res.status(201).json({ data: thread });
});

router.post("/learning/doubts/:id/messages", allow(Role.STUDENT, Role.TEACHER), async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const thread = await prisma.doubtThread.findFirst({ where: { id: String(req.params.id), ...learningDoubtWhere(actor) }, include: { messages: { select: { role: true, content: true }, orderBy: { createdAt: "asc" } }, student: { select: { studentProfile: { select: { batchId: true, batch: { select: { courseId: true } } } } } } } });
  if (!thread) throw new AppError(404, "DOUBT_NOT_FOUND", "Doubt not found");
  const d = z.object({ message: z.string().trim().min(1).max(8000) }).parse(req.body);
  const message = await prisma.doubtMessage.create({ data: { threadId: thread.id, authorId: actor.userId, role: actor.role === Role.TEACHER ? "TEACHER" : "STUDENT", content: d.message } });
  if (actor.role === Role.TEACHER) {
    await prisma.doubtThread.update({ where: { id: thread.id }, data: { status: DoubtStatus.RESOLVED, confidence: 1 } });
    return res.status(201).json({ data: message });
  }
  const profile = thread.student.studentProfile;
  if (!profile?.batch.courseId) throw learningDenied();
  const answer = await contextualAnswer({ title: thread.title, message: d.message, subjectId: thread.subjectId ?? undefined, chapter: thread.chapter ?? undefined, topic: thread.topic ?? undefined }, thread.messages, { courseId: profile.batch.courseId, batchId: profile.batchId });
  const ai = await prisma.doubtMessage.create({ data: { threadId: thread.id, role: "AI", content: answer.content, confidence: answer.confidence, sources: answer.sources } });
  await prisma.doubtThread.update({ where: { id: thread.id }, data: { confidence: answer.confidence, status: answer.confidence >= .65 ? DoubtStatus.ANSWERED : DoubtStatus.OPEN } });
  res.status(201).json({ data: { studentMessage: message, answer: ai } });
});

router.patch("/learning/doubts/:id/bookmark", allow(Role.STUDENT), async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const thread = await prisma.doubtThread.findFirst({ where: { id: String(req.params.id), ...learningDoubtWhere(actor) } });
  if (!thread) throw new AppError(404, "DOUBT_NOT_FOUND", "Doubt not found");
  const bookmarked = z.object({ bookmarked: z.boolean() }).parse(req.body).bookmarked;
  res.json({ data: await prisma.doubtThread.update({ where: { id: thread.id }, data: { bookmarked } }) });
});

router.post("/learning/doubts/:id/escalate", allow(Role.STUDENT), async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const d = z.object({ teacherId: id.optional() }).parse(req.body);
  const thread = await prisma.doubtThread.findFirst({ where: { id: String(req.params.id), ...learningDoubtWhere(actor) }, include: { student: { select: { studentProfile: { select: { branchId: true, batchId: true, batch: { select: { courseId: true, academicSessionId: true } } } } } } } });
  const profile = thread?.student.studentProfile;
  if (!thread || !profile?.batch.courseId) throw new AppError(404, "DOUBT_NOT_FOUND", "Doubt not found");
  const allocation = await prisma.teacherAllocation.findFirst({ where: { branchId: profile.branchId, courseId: profile.batch.courseId, batchId: profile.batchId, ...(thread.subjectId ? { subjectId: thread.subjectId } : {}), ...(d.teacherId ? { teacherId: d.teacherId } : {}), academicSessionId: profile.batch.academicSessionId, status: "ACTIVE", effectiveFrom: { lte: new Date() }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }] }, select: { teacher: { select: { userId: true } } } });
  if (!allocation) throw new AppError(422, "NO_TEACHER_AVAILABLE", "No teacher is available for escalation");
  const updated = await prisma.doubtThread.update({ where: { id: thread.id }, data: { status: DoubtStatus.ESCALATED, assignedTeacherId: allocation.teacher.userId } });
  await Promise.all([notify(allocation.teacher.userId, "Student doubt escalated", thread.title, "AI_DOUBT", thread.id), audit(req, "ESCALATE", "DoubtThread", thread.id)]);
  res.json({ data: updated });
});

const questionInput = z.object({ code: z.string().trim().min(2).max(50), examCategory: z.enum(["CBSE", "JEE_MAIN", "NEET", "CUET"]), type: questionTypes, subjectId: id, courseId: id.optional(), chapter: z.string().trim().min(1).max(150), topic: z.string().trim().max(150).optional(), difficulty: z.enum(["EASY", "MEDIUM", "HARD"]), marks: z.number().positive().max(100), negativeMarks: z.number().min(0).max(100).default(0), year: z.number().int().min(1990).max(2100).optional(), source: z.string().max(150).optional(), tags: z.array(z.string().max(40)).max(20).default([]), bloomLevel: z.enum(["REMEMBER", "UNDERSTAND", "APPLY", "ANALYZE", "EVALUATE", "CREATE"]).optional(), body: z.string().min(3).max(20000), options: z.unknown().optional(), correctAnswer: z.unknown(), solution: z.string().max(20000).optional() });
router.get("/learning/questions", managers, async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const q = pageQuery.extend({ examCategory: z.string().optional(), subjectId: id.optional(), chapter: z.string().optional(), difficulty: z.string().optional(), type: questionTypes.optional(), approvalStatus: z.nativeEnum(ApprovalStatus).optional() }).parse(req.query);
  const where: any = { ...learningQuestionWhere(actor), isArchived: false, ...(q.examCategory ? { examCategory: q.examCategory } : {}), ...(q.subjectId ? { subjectId: q.subjectId } : {}), ...(q.chapter ? { chapter: { contains: q.chapter, mode: "insensitive" } } : {}), ...(q.difficulty ? { difficulty: q.difficulty } : {}), ...(q.type ? { type: q.type } : {}), ...(q.approvalStatus ? { approvalStatus: q.approvalStatus } : {}), ...(q.search ? { OR: [{ body: { contains: q.search, mode: "insensitive" } }, { code: { contains: q.search, mode: "insensitive" } }, { topic: { contains: q.search, mode: "insensitive" } }] } : {}) };
  const [total, data] = await prisma.$transaction([
    prisma.questionBankItem.count({ where }),
    prisma.questionBankItem.findMany({ where, include: { createdBy: { select: { name: true } }, reviewedBy: { select: { name: true } }, _count: { select: { revisions: true, testQuestions: true } } }, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { createdAt: q.sortOrder } }),
  ]);
  res.json({ data, meta: { total, page: q.page, limit: q.limit, totalPages: Math.max(1, Math.ceil(total / q.limit)) } });
});

router.post("/learning/questions", managers, async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const d = questionInput.parse(req.body);
  await relationCheck(d);
  assertManagerQuestionAccess(actor, d);
  try {
    const row = await prisma.questionBankItem.create({ data: { ...d, options: d.options as object | undefined, correctAnswer: d.correctAnswer as object, createdById: actor.userId } });
    await audit(req, "CREATE", "QuestionBankItem", row.id);
    res.status(201).json({ data: row });
  } catch (error: any) {
    if (error.code === "P2002") throw new AppError(409, "DUPLICATE_QUESTION_CODE", "Question code already exists");
    throw error;
  }
});

router.patch("/learning/questions/:id", managers, async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const old = await prisma.questionBankItem.findFirst({ where: { id: String(req.params.id), ...learningQuestionWhere(actor) } });
  if (!old) throw new AppError(404, "QUESTION_NOT_FOUND", "Question not found");
  const d = questionInput.partial().parse(req.body);
  const target = { courseId: d.courseId === undefined ? old.courseId : d.courseId, subjectId: d.subjectId ?? old.subjectId };
  await relationCheck(target);
  assertManagerQuestionAccess(actor, target);
  const snapshot = JSON.parse(JSON.stringify(old));
  const row = await prisma.$transaction(async tx => {
    await tx.questionBankRevision.create({ data: { questionId: old.id, version: old.version, snapshot, changedById: actor.userId } });
    return tx.questionBankItem.update({ where: { id: old.id }, data: { ...d, options: d.options as object | undefined, correctAnswer: d.correctAnswer as object | undefined, version: { increment: 1 }, approvalStatus: ApprovalStatus.DRAFT } });
  });
  await audit(req, "UPDATE", "QuestionBankItem", row.id);
  res.json({ data: row });
});

router.patch("/learning/questions/:id/approval", managers, async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const question = await prisma.questionBankItem.findFirst({ where: { id: String(req.params.id), ...learningQuestionWhere(actor) }, select: { id: true } });
  if (!question) throw new AppError(404, "QUESTION_NOT_FOUND", "Question not found");
  const { approvalStatus } = z.object({ approvalStatus: z.enum(["PENDING", "APPROVED", "REJECTED", "ARCHIVED"]) }).parse(req.body);
  const row = await prisma.questionBankItem.update({ where: { id: question.id }, data: { approvalStatus, reviewedById: actor.userId, reviewedAt: new Date(), isArchived: approvalStatus === "ARCHIVED" } });
  await audit(req, approvalStatus, "QuestionBankItem", row.id);
  res.json({ data: row });
});

router.post("/learning/questions/bulk", managers, async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const rows = z.object({ questions: z.array(questionInput).min(1).max(500) }).parse(req.body).questions;
  for (const row of rows) { await relationCheck(row); assertManagerQuestionAccess(actor, row); }
  const created = [];
  for (const row of rows) created.push(await prisma.questionBankItem.create({ data: { ...row, options: row.options as object | undefined, correctAnswer: row.correctAnswer as object, createdById: actor.userId } }));
  await audit(req, "BULK_IMPORT", "QuestionBankItem", undefined, { count: created.length });
  res.status(201).json({ data: created, meta: { imported: created.length } });
});

router.get("/learning/questions/export", managers, async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const rows = await prisma.questionBankItem.findMany({ where: { ...learningQuestionWhere(actor), isArchived: false }, orderBy: { createdAt: "desc" } });
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="question-bank-${Date.now()}.json"`);
  res.send(JSON.stringify(rows));
});

router.post("/learning/questions/random", managers, async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const d = z.object({ count: z.number().int().min(1).max(200), examCategory: z.string().optional(), subjectId: id.optional(), chapter: z.string().optional(), difficulty: z.string().optional() }).parse(req.body);
  const rows = await prisma.questionBankItem.findMany({ where: { ...learningQuestionWhere(actor), approvalStatus: ApprovalStatus.APPROVED, isArchived: false, ...(d.examCategory ? { examCategory: d.examCategory } : {}), ...(d.subjectId ? { subjectId: d.subjectId } : {}), ...(d.chapter ? { chapter: d.chapter } : {}), ...(d.difficulty ? { difficulty: d.difficulty } : {}) } });
  res.json({ data: rows.sort(() => Math.random() - .5).slice(0, d.count) });
});

const testInput = z.object({ code: z.string().min(2).max(50), name: z.string().min(3).max(180), type: z.nativeEnum(LearningTestType), branchId: id.optional(), courseId: id, batchId: id.optional(), subjectId: id.optional(), chapter: z.string().max(150).optional(), instructions: z.string().max(10000).optional(), durationMinutes: z.number().int().min(1).max(360), maximumMarks: z.number().positive(), passingMarks: z.number().min(0), startsAt: z.coerce.date().optional(), endsAt: z.coerce.date().optional(), adaptive: z.boolean().default(false), status: z.nativeEnum(LearningStatus).default(LearningStatus.DRAFT), questions: z.array(z.object({ questionId: id, section: z.string().max(80).default("General"), position: z.number().int().positive(), marks: z.number().positive(), negativeMarks: z.number().min(0).default(0) })).min(1).max(300) });
async function assertTestQuestions(actor: LearningActor, target: { courseId: string; subjectId?: string | null }, questions: Array<{ questionId: string }>) {
  const uniqueIds = [...new Set(questions.map(row => row.questionId))];
  const rows = await prisma.questionBankItem.findMany({ where: { id: { in: uniqueIds }, ...learningQuestionWhere(actor), isArchived: false }, select: { id: true, courseId: true, subjectId: true } });
  if (rows.length !== uniqueIds.length || rows.some(row => row.courseId && row.courseId !== target.courseId || target.subjectId && row.subjectId !== target.subjectId)) {
    throw new AppError(422, "INVALID_TEST_QUESTION", "Every test question must be authorized and match the Test Course and Subject");
  }
}

router.get("/learning/tests", async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const q = pageQuery.extend({ type: z.nativeEnum(LearningTestType).optional(), status: z.nativeEnum(LearningStatus).optional(), courseId: id.optional(), batchId: id.optional(), subjectId: id.optional() }).parse(req.query);
  const learner = actor.role === Role.STUDENT || actor.role === Role.PARENT;
  const where: any = { ...learningResourceWhere(actor), ...(learner ? {} : q.status ? { status: q.status } : {}), ...(q.type ? { type: q.type } : {}), ...(q.courseId ? { courseId: q.courseId } : {}), ...(q.batchId ? { batchId: q.batchId } : {}), ...(q.subjectId ? { subjectId: q.subjectId } : {}), ...(q.search ? { OR: [{ name: { contains: q.search, mode: "insensitive" } }, { code: { contains: q.search, mode: "insensitive" } }] } : {}) };
  const [total, data] = await prisma.$transaction([
    prisma.learningTest.count({ where }),
    prisma.learningTest.findMany({ where, include: { _count: { select: { questions: true, attempts: true } } }, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { createdAt: q.sortOrder } }),
  ]);
  res.json({ data, meta: { total, page: q.page, limit: q.limit, totalPages: Math.max(1, Math.ceil(total / q.limit)) } });
});

router.post("/learning/tests", managers, async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const d = testInput.refine(row => row.passingMarks <= row.maximumMarks, "Passing marks cannot exceed maximum marks").refine(row => !row.startsAt || !row.endsAt || row.endsAt > row.startsAt, "End time must be after start time").parse(req.body);
  await relationCheck(d);
  assertManagerResourceAccess(actor, d);
  await assertTestQuestions(actor, d, d.questions);
  const { questions, ...test } = d;
  const row = await prisma.learningTest.create({ data: { ...test, createdById: actor.userId, questions: { create: questions } }, include: { questions: true } });
  await audit(req, "CREATE", "LearningTest", row.id);
  res.status(201).json({ data: row });
});

router.patch("/learning/tests/:id", managers, async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const old = await prisma.learningTest.findFirst({ where: { id: String(req.params.id), ...learningResourceWhere(actor) } });
  if (!old) throw new AppError(404, "TEST_NOT_FOUND", "Test not found");
  const d = testInput.partial().parse(req.body), { questions, ...test } = d;
  const target = { courseId: test.courseId ?? old.courseId, batchId: test.batchId === undefined ? old.batchId : test.batchId, subjectId: test.subjectId === undefined ? old.subjectId : test.subjectId, branchId: test.branchId === undefined ? old.branchId : test.branchId };
  await relationCheck(target);
  assertManagerResourceAccess(actor, target);
  if (questions) await assertTestQuestions(actor, target, questions);
  const row = await prisma.learningTest.update({ where: { id: old.id }, data: { ...test, ...(questions ? { questions: { deleteMany: {}, create: questions } } : {}) }, include: { questions: true } });
  await audit(req, "UPDATE", "LearningTest", row.id);
  res.json({ data: row });
});

router.delete("/learning/tests/:id", managers, async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const row = await prisma.learningTest.findFirst({ where: { id: String(req.params.id), ...learningResourceWhere(actor) }, include: { _count: { select: { attempts: true } } } });
  if (!row) throw new AppError(404, "TEST_NOT_FOUND", "Test not found");
  if (row._count.attempts) throw new AppError(409, "TEST_HAS_ATTEMPTS", "Tests with attempts cannot be deleted");
  if (row.status !== LearningStatus.ARCHIVED) throw new AppError(409, "ARCHIVE_BEFORE_DELETE", "Archive the test before deletion");
  await prisma.learningTest.delete({ where: { id: row.id } });
  await audit(req, "DELETE", "LearningTest", row.id);
  res.status(204).send();
});

router.post("/learning/tests/:id/start", allow(Role.STUDENT), async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const test = await prisma.learningTest.findFirst({ where: { id: String(req.params.id), ...learningResourceWhere(actor) }, include: { questions: { include: { question: { select: { id: true, code: true, type: true, body: true, options: true, marks: true } } }, orderBy: { position: "asc" } } } });
  if (!test) throw new AppError(404, "TEST_NOT_AVAILABLE", "Test is not available");
  const now = new Date();
  if (test.startsAt && test.startsAt > now || test.endsAt && test.endsAt < now) throw new AppError(409, "TEST_OUTSIDE_WINDOW", "Test is outside its availability window");
  const active = await prisma.learningTestAttempt.findFirst({ where: { testId: test.id, studentId: actor.userId, status: LearningAttemptStatus.IN_PROGRESS } });
  const attempt = active ?? await prisma.learningTestAttempt.create({ data: { testId: test.id, studentId: actor.userId, expiresAt: new Date(Date.now() + test.durationMinutes * 60000), unansweredCount: test.questions.length } });
  res.status(active ? 200 : 201).json({ data: { attempt, test } });
});

router.put("/learning/attempts/:id/answers/:questionId", allow(Role.STUDENT), async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const attempt = await prisma.learningTestAttempt.findFirst({ where: { id: String(req.params.id), studentId: actor.userId }, include: { test: true } });
  if (!attempt || attempt.status !== LearningAttemptStatus.IN_PROGRESS) throw new AppError(409, "ATTEMPT_NOT_ACTIVE", "Attempt is not active");
  assertLearnerContentAccess(actor, attempt.test);
  if (attempt.expiresAt < new Date()) throw new AppError(409, "ATTEMPT_EXPIRED", "Time has expired; submit the attempt");
  const questionId = String(req.params.questionId);
  const attached = await prisma.learningTestQuestion.findFirst({ where: { testId: attempt.testId, questionId }, select: { questionId: true } });
  if (!attached) throw new AppError(404, "TEST_QUESTION_NOT_FOUND", "Question is not part of this test");
  const d = z.object({ answer: z.unknown().optional(), markedForReview: z.boolean().default(false), bookmarked: z.boolean().default(false), timeSpentSeconds: z.number().int().min(0).max(86400).default(0) }).parse(req.body);
  const row = await prisma.learningTestAnswer.upsert({ where: { attemptId_questionId: { attemptId: attempt.id, questionId } }, update: { ...d, answer: d.answer as object | undefined }, create: { attemptId: attempt.id, questionId, ...d, answer: d.answer as object | undefined } });
  res.json({ data: row });
});
async function finalizeAttempt(attemptId: string, actor: LearningActor) { const attempt = await prisma.learningTestAttempt.findFirst({ where: { id: attemptId, studentId: actor.userId }, include: { test: { include: { questions: { include: { question: true } } } }, answers: true } }); if (!attempt) throw new AppError(404, "ATTEMPT_NOT_FOUND", "Attempt not found"); assertLearnerContentAccess(actor, attempt.test); if (attempt.status !== LearningAttemptStatus.IN_PROGRESS) return attempt; const answers = new Map(attempt.answers.map(x => [x.questionId, x])), normalized = (v: unknown) => JSON.stringify(v, Object.keys((v && typeof v === "object" && !Array.isArray(v) ? v as object : {}) as object).sort()); let score = 0, correct = 0, incorrect = 0, unanswered = 0, seconds = 0; const updates = []; for (const tq of attempt.test.questions) { const answer = answers.get(tq.questionId); seconds += answer?.timeSpentSeconds ?? 0; if (!answer || answer.answer == null) { unanswered++; continue; } const ok = normalized(answer.answer) === normalized(tq.question.correctAnswer); const marks = ok ? Number(tq.marks) : -Number(tq.negativeMarks); score += marks; ok ? correct++ : incorrect++; updates.push(prisma.learningTestAnswer.update({ where: { id: answer.id }, data: { isCorrect: ok, awardedMarks: marks } })); } const pct = Math.max(0, Number(attempt.test.maximumMarks) ? score / Number(attempt.test.maximumMarks) * 100 : 0); const better = await prisma.learningTestAttempt.count({ where: { testId: attempt.testId, status: LearningAttemptStatus.EVALUATED, score: { gt: score } } }), total = await prisma.learningTestAttempt.count({ where: { testId: attempt.testId, status: LearningAttemptStatus.EVALUATED } }), rank = better + 1, percentile = total ? Math.max(0, (total - better) / total * 100) : 100; const result = await prisma.$transaction([...updates, prisma.learningTestAttempt.update({ where: { id: attempt.id }, data: { status: LearningAttemptStatus.EVALUATED, submittedAt: new Date(), score, percentage: pct, percentile, rank, correctCount: correct, incorrectCount: incorrect, unansweredCount: unanswered, timeSpentSeconds: seconds } })]); await prisma.gamificationProfile.upsert({ where: { userId: actor.userId }, update: { xp: { increment: correct * 5 }, coins: { increment: correct } }, create: { userId: actor.userId, xp: correct * 5, coins: correct } }); return result[result.length - 1]; }
router.post("/learning/attempts/:id/submit", allow(Role.STUDENT), async (req: AuthRequest, res) => { const actor = await learningActorForRequest(req); const result = await finalizeAttempt(String(req.params.id), actor); await audit(req, "SUBMIT", "LearningTestAttempt", String(req.params.id)); res.json({ data: result }); });
router.get("/learning/tests/:id/results", async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const test = await prisma.learningTest.findFirst({ where: { id: String(req.params.id), ...learningResourceWhere(actor) }, select: { id: true } });
  if (!test) throw new AppError(404, "TEST_NOT_FOUND", "Test not found");
  const data = await prisma.learningTestAttempt.findMany({ where: { testId: test.id, status: LearningAttemptStatus.EVALUATED, ...learningAttemptStudentWhere(actor) }, include: { student: { select: { name: true } }, answers: true }, orderBy: [{ score: "desc" }, { timeSpentSeconds: "asc" }] });
  res.json({ data });
});

router.get("/learning/leaderboard", allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN, Role.TEACHER, Role.STUDENT), async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const q = z.object({ testId: id.optional(), limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(req.query);
  if (q.testId) {
    const test = await prisma.learningTest.findFirst({ where: { id: q.testId, ...learningResourceWhere(actor) }, select: { id: true } });
    if (!test) throw new AppError(404, "TEST_NOT_FOUND", "Test not found");
    const data = await prisma.learningTestAttempt.findMany({ where: { testId: test.id, status: LearningAttemptStatus.EVALUATED }, include: { student: { select: { name: true, avatarUrl: true } } }, take: q.limit, orderBy: [{ score: "desc" }, { timeSpentSeconds: "asc" }] });
    return res.json({ data });
  }
  const userScope = actor.role === Role.SUPER_ADMIN ? {} : actor.role === Role.STUDENT
    ? { studentProfile: { is: { batchId: actor.learners[0]?.batchId ?? "" } } }
    : actor.role === Role.BRANCH_ADMIN
      ? { studentProfile: { is: { branchId: { in: actor.branchIds } } } }
      : { studentProfile: { is: { batchId: { in: [...new Set(actor.allocations.map(row => row.batchId))] } } } };
  const data = await prisma.gamificationProfile.findMany({ where: { user: userScope }, include: { user: { select: { name: true, avatarUrl: true } } }, take: q.limit, orderBy: { xp: "desc" } });
  res.json({ data });
});

const materialInput = z.object({ title: z.string().min(3).max(180), description: z.string().max(10000).optional(), type: z.nativeEnum(StudyMaterialType), branchId: id.optional(), courseId: id, batchId: id.optional(), subjectId: id.optional(), chapter: z.string().max(150).optional(), topic: z.string().max(150).optional(), teacherId: id.optional(), tags: z.array(z.string().max(40)).max(20).default([]), status: z.nativeEnum(LearningStatus).default(LearningStatus.DRAFT), externalUrl: z.string().url().optional(), file: fileInput.optional() });
router.get("/learning/materials", async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const q = pageQuery.extend({ type: z.nativeEnum(StudyMaterialType).optional(), courseId: id.optional(), batchId: id.optional(), subjectId: id.optional(), chapter: z.string().optional(), bookmarked: z.coerce.boolean().optional() }).parse(req.query);
  const where: any = { ...learningResourceWhere(actor), isArchived: false, ...(q.type ? { type: q.type } : {}), ...(q.courseId ? { courseId: q.courseId } : {}), ...(q.batchId ? { batchId: q.batchId } : {}), ...(q.subjectId ? { subjectId: q.subjectId } : {}), ...(q.chapter ? { chapter: { contains: q.chapter, mode: "insensitive" } } : {}), ...(q.search ? { OR: [{ title: { contains: q.search, mode: "insensitive" } }, { description: { contains: q.search, mode: "insensitive" } }, { topic: { contains: q.search, mode: "insensitive" } }] } : {}), ...(q.bookmarked ? { bookmarks: { some: { userId: actor.userId } } } : {}) };
  const [total, data] = await prisma.$transaction([
    prisma.studyMaterial.count({ where }),
    prisma.studyMaterial.findMany({ where, include: { bookmarks: { where: { userId: actor.userId }, select: { userId: true } } }, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { createdAt: q.sortOrder } }),
  ]);
  res.json({ data: data.map(({ fileData, ...row }) => ({ ...row, hasFile: Boolean(fileData), bookmarked: row.bookmarks.length > 0 })), meta: { total, page: q.page, limit: q.limit, totalPages: Math.max(1, Math.ceil(total / q.limit)) } });
});

router.post("/learning/materials", managers, async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const d = materialInput.parse(req.body);
  await relationCheck(d);
  assertManagerResourceAccess(actor, d, { teacherOwned: true });
  const file = d.file ? decodeFile(d.file, 15 * 1048576, ["application/pdf", "image/jpeg", "image/png", "video/mp4", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]) : null;
  if (!file && !d.externalUrl) throw new AppError(422, "MATERIAL_REQUIRED", "Upload a file or provide an external URL");
  const { file: raw, ...rest } = d;
  const row = await prisma.studyMaterial.create({ data: { ...rest, ...(file ? { fileName: raw!.name, mimeType: raw!.mimeType, fileSize: file.length, fileData: file } : {}) } });
  await audit(req, "CREATE", "StudyMaterial", row.id);
  res.status(201).json({ data: { ...row, fileData: undefined } });
});

router.patch("/learning/materials/:id", managers, async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const old = await prisma.studyMaterial.findFirst({ where: { id: String(req.params.id), ...learningResourceWhere(actor, { teacherOwned: actor.role === Role.TEACHER }) } });
  if (!old) throw new AppError(404, "MATERIAL_NOT_FOUND", "Material not found");
  const d = materialInput.partial().parse(req.body);
  const target = { branchId: d.branchId === undefined ? old.branchId : d.branchId, courseId: d.courseId ?? old.courseId, batchId: d.batchId === undefined ? old.batchId : d.batchId, subjectId: d.subjectId === undefined ? old.subjectId : d.subjectId, teacherId: d.teacherId === undefined ? old.teacherId : d.teacherId };
  await relationCheck(target);
  assertManagerResourceAccess(actor, target, { teacherOwned: true });
  const file = d.file ? decodeFile(d.file, 15 * 1048576) : null, { file: raw, ...rest } = d;
  const row = await prisma.studyMaterial.update({ where: { id: old.id }, data: { ...rest, version: { increment: 1 }, ...(file ? { fileName: raw!.name, mimeType: raw!.mimeType, fileSize: file.length, fileData: file } : {}) } });
  await audit(req, "UPDATE", "StudyMaterial", row.id);
  res.json({ data: { ...row, fileData: undefined } });
});

router.get("/learning/materials/:id/download", async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const row = await prisma.studyMaterial.findFirst({ where: { id: String(req.params.id), ...learningResourceWhere(actor), isArchived: false } });
  if (!row) throw new AppError(404, "MATERIAL_NOT_FOUND", "Material not found");
  if (!row.fileData && row.externalUrl) return res.redirect(row.externalUrl);
  if (!row.fileData) throw new AppError(404, "FILE_NOT_FOUND", "Material file not found");
  await prisma.studyMaterial.update({ where: { id: row.id }, data: { downloadCount: { increment: 1 } } });
  res.set({ "Content-Type": row.mimeType ?? "application/octet-stream", "Content-Disposition": `attachment; filename="${(row.fileName ?? "material").replace(/["\r\n]/g, "")}"`, "Content-Length": String(row.fileData.length) }).send(Buffer.from(row.fileData));
});

router.post("/learning/materials/:id/bookmark", allow(Role.STUDENT, Role.PARENT), async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const materialId = String(req.params.id);
  const material = await prisma.studyMaterial.findFirst({ where: { id: materialId, ...learningResourceWhere(actor), isArchived: false }, select: { id: true } });
  if (!material) throw new AppError(404, "MATERIAL_NOT_FOUND", "Material not found");
  const row = await prisma.studyMaterialBookmark.upsert({ where: { materialId_userId: { materialId, userId: actor.userId } }, update: {}, create: { materialId, userId: actor.userId } });
  res.status(201).json({ data: row });
});

router.delete("/learning/materials/:id/bookmark", allow(Role.STUDENT, Role.PARENT), async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const materialId = String(req.params.id);
  const material = await prisma.studyMaterial.findFirst({ where: { id: materialId, ...learningResourceWhere(actor), isArchived: false }, select: { id: true } });
  if (!material) throw new AppError(404, "MATERIAL_NOT_FOUND", "Material not found");
  await prisma.studyMaterialBookmark.deleteMany({ where: { materialId, userId: actor.userId } });
  res.status(204).send();
});

router.delete("/learning/materials/:id", managers, async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const row = await prisma.studyMaterial.findFirst({ where: { id: String(req.params.id), ...learningResourceWhere(actor, { teacherOwned: actor.role === Role.TEACHER }) }, include: { _count: { select: { bookmarks: true } } } });
  if (!row) throw new AppError(404, "MATERIAL_NOT_FOUND", "Material not found");
  if (!row.isArchived && row.status !== LearningStatus.ARCHIVED) { await prisma.studyMaterial.update({ where: { id: row.id }, data: { isArchived: true, status: LearningStatus.ARCHIVED } }); return res.status(202).json({ data: { archived: true } }); }
  if (row._count.bookmarks) throw new AppError(409, "MATERIAL_BOOKMARKED", "Bookmarked material cannot be permanently deleted");
  await prisma.studyMaterial.delete({ where: { id: row.id } });
  await audit(req, "DELETE", "StudyMaterial", row.id);
  res.status(204).send();
});

const liveShape = z.object({ title: z.string().min(3).max(180), description: z.string().max(5000).optional(), provider: z.nativeEnum(LiveClassProvider), meetingUrl: z.string().url().refine(x => x.startsWith("https://"), "Meeting URL must use HTTPS"), meetingId: z.string().max(100).optional(), meetingPassword: z.string().max(100).optional(), branchId: id, courseId: id, batchId: id, subjectId: id, teacherId: id, startsAt: z.coerce.date(), endsAt: z.coerce.date(), recordingUrl: z.string().url().optional(), whiteboardUrl: z.string().url().optional(), status: z.nativeEnum(LearningStatus).default(LearningStatus.DRAFT) });
const liveInput = liveShape.refine(x => x.endsAt > x.startsAt, "End time must be after start time");
router.get("/learning/live-classes", async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const q = pageQuery.extend({ batchId: id.optional(), subjectId: id.optional(), status: z.nativeEnum(LearningStatus).optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional() }).parse(req.query);
  const learner = actor.role === Role.STUDENT || actor.role === Role.PARENT;
  const where: any = { ...learningResourceWhere(actor, { teacherOwned: actor.role === Role.TEACHER }), ...(learner ? {} : q.status ? { status: q.status } : {}), ...(q.batchId ? { batchId: q.batchId } : {}), ...(q.subjectId ? { subjectId: q.subjectId } : {}), ...(q.from || q.to ? { startsAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}), ...(q.search ? { title: { contains: q.search, mode: "insensitive" } } : {}) };
  const [total, data] = await prisma.$transaction([
    prisma.liveClass.count({ where }),
    prisma.liveClass.findMany({ where, include: { _count: { select: { attendances: true, interactions: true } } }, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { startsAt: q.sortOrder } }),
  ]);
  res.json({ data, meta: { total, page: q.page, limit: q.limit, totalPages: Math.max(1, Math.ceil(total / q.limit)) } });
});

router.post("/learning/live-classes", managers, async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const d = liveInput.parse(req.body);
  await relationCheck(d);
  assertManagerResourceAccess(actor, d, { teacherOwned: true });
  const conflict = await prisma.liveClass.findFirst({ where: { teacherId: d.teacherId, status: { not: LearningStatus.ARCHIVED }, startsAt: { lt: d.endsAt }, endsAt: { gt: d.startsAt } } });
  if (conflict) throw new AppError(409, "TEACHER_SCHEDULE_CONFLICT", "Teacher already has a live class in this time slot");
  const row = await prisma.liveClass.create({ data: d });
  const students = await prisma.studentProfile.findMany({ where: { batchId: d.batchId, status: "ACTIVE", user: { isActive: true } }, select: { userId: true } });
  if (d.status === LearningStatus.PUBLISHED) await Promise.all(students.map(student => notify(student.userId, "Live class scheduled", `${d.title} starts ${d.startsAt.toLocaleString("en-IN")}`, "LIVE_CLASS", row.id)));
  await audit(req, "CREATE", "LiveClass", row.id);
  res.status(201).json({ data: row });
});

router.patch("/learning/live-classes/:id", managers, async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const old = await prisma.liveClass.findFirst({ where: { id: String(req.params.id), ...learningResourceWhere(actor, { teacherOwned: actor.role === Role.TEACHER }) } });
  if (!old) throw new AppError(404, "LIVE_CLASS_NOT_FOUND", "Live class not found");
  const d = liveShape.partial().parse(req.body);
  const target = { branchId: d.branchId ?? old.branchId, courseId: d.courseId ?? old.courseId, batchId: d.batchId ?? old.batchId, subjectId: d.subjectId ?? old.subjectId, teacherId: d.teacherId ?? old.teacherId };
  await relationCheck(target);
  assertManagerResourceAccess(actor, target, { teacherOwned: true });
  const startsAt = d.startsAt ?? old.startsAt, endsAt = d.endsAt ?? old.endsAt;
  if (endsAt <= startsAt) throw new AppError(422, "INVALID_TIME", "End time must be after start time");
  const conflict = await prisma.liveClass.findFirst({ where: { id: { not: old.id }, teacherId: target.teacherId, status: { not: LearningStatus.ARCHIVED }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } }, select: { id: true } });
  if (conflict) throw new AppError(409, "TEACHER_SCHEDULE_CONFLICT", "Teacher already has a live class in this time slot");
  const row = await prisma.liveClass.update({ where: { id: old.id }, data: d });
  await audit(req, "UPDATE", "LiveClass", row.id);
  res.json({ data: row });
});

router.post("/learning/live-classes/:id/join", async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const live = await prisma.liveClass.findFirst({ where: { id: String(req.params.id), ...learningResourceWhere(actor, { teacherOwned: actor.role === Role.TEACHER }), status: LearningStatus.PUBLISHED } });
  if (!live) throw new AppError(404, "LIVE_CLASS_NOT_FOUND", "Live class is not available");
  const attendance = await prisma.liveClassAttendance.upsert({ where: { liveClassId_userId: { liveClassId: live.id, userId: actor.userId } }, update: { joinedAt: new Date(), leftAt: null }, create: { liveClassId: live.id, userId: actor.userId } });
  res.json({ data: { attendance, meetingUrl: live.meetingUrl, meetingId: live.meetingId, meetingPassword: live.meetingPassword, whiteboardUrl: live.whiteboardUrl } });
});

router.post("/learning/live-classes/:id/leave", async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const liveClassId = String(req.params.id);
  const live = await prisma.liveClass.findFirst({ where: { id: liveClassId, ...learningResourceWhere(actor, { teacherOwned: actor.role === Role.TEACHER }) }, select: { id: true } });
  if (!live) throw new AppError(404, "LIVE_CLASS_NOT_FOUND", "Live class is not available");
  const row = await prisma.liveClassAttendance.findUnique({ where: { liveClassId_userId: { liveClassId, userId: actor.userId } } });
  if (!row) throw new AppError(404, "ATTENDANCE_NOT_FOUND", "Join record not found");
  const now = new Date(), updated = await prisma.liveClassAttendance.update({ where: { id: row.id }, data: { leftAt: now, durationSeconds: { increment: Math.max(0, Math.round((now.getTime() - row.joinedAt.getTime()) / 1000)) } } });
  res.json({ data: updated });
});

router.post("/learning/live-classes/:id/interactions", async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const liveClassId = String(req.params.id);
  const live = await prisma.liveClass.findFirst({ where: { id: liveClassId, ...learningResourceWhere(actor, { teacherOwned: actor.role === Role.TEACHER }), status: LearningStatus.PUBLISHED }, select: { id: true } });
  if (!live) throw new AppError(404, "LIVE_CLASS_NOT_FOUND", "Live class is not available");
  const d = z.object({ type: z.enum(["CHAT", "POLL", "POLL_RESPONSE", "RAISE_HAND", "WHITEBOARD"]), content: z.unknown().optional() }).parse(req.body);
  const row = await prisma.liveClassInteraction.create({ data: { liveClassId, userId: actor.userId, type: d.type, content: d.content as object | undefined } });
  res.status(201).json({ data: row });
});

router.get("/learning/gamification/me", allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN, Role.TEACHER, Role.STUDENT), async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  if (actor.role === Role.STUDENT && !actor.learners.length) throw learningDenied();
  const profile = await prisma.gamificationProfile.upsert({ where: { userId: actor.userId }, update: {}, create: { userId: actor.userId } });
  const [badges, challenges] = await Promise.all([
    prisma.studentBadge.findMany({ where: { userId: actor.userId }, include: { badge: true } }),
    prisma.challengeProgress.findMany({ where: { userId: actor.userId }, include: { challenge: true } }),
  ]);
  res.json({ data: { profile, badges, challenges } });
});

router.post("/learning/goals", allow(Role.STUDENT), async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  if (!actor.learners.length) throw learningDenied();
  const d = z.object({ date: z.coerce.date(), targetMinutes: z.number().int().min(1).max(1440), targetQuestions: z.number().int().min(1).max(1000) }).parse(req.body);
  const row = await prisma.dailyLearningGoal.upsert({ where: { userId_date: { userId: actor.userId, date: d.date } }, update: d, create: { userId: actor.userId, ...d } });
  res.json({ data: row });
});

router.patch("/learning/goals/:id/progress", allow(Role.STUDENT), async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  if (!actor.learners.length) throw learningDenied();
  const goal = await prisma.dailyLearningGoal.findFirst({ where: { id: String(req.params.id), userId: actor.userId } });
  if (!goal) throw new AppError(404, "GOAL_NOT_FOUND", "Goal not found");
  const d = z.object({ minutes: z.number().int().min(0).max(1440).default(0), questions: z.number().int().min(0).max(1000).default(0) }).parse(req.body), minutes = goal.completedMinutes + d.minutes, questions = goal.completedQuestions + d.questions, completed = minutes >= goal.targetMinutes && questions >= goal.targetQuestions;
  const row = await prisma.dailyLearningGoal.update({ where: { id: goal.id }, data: { completedMinutes: minutes, completedQuestions: questions, completed } });
  if (completed && !goal.completed) await prisma.gamificationProfile.upsert({ where: { userId: actor.userId }, update: { xp: { increment: 20 }, coins: { increment: 5 } }, create: { userId: actor.userId, xp: 20, coins: 5 } });
  res.json({ data: row });
});

router.post("/learning/recommendations/generate", allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN, Role.TEACHER, Role.STUDENT), async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const target = actor.role === Role.STUDENT ? actor.userId : z.object({ userId: id }).parse(req.body).userId;
  await assertStudentTargetAccess(actor, target);
  const attempts = await prisma.learningTestAttempt.findMany({ where: { studentId: target, status: LearningAttemptStatus.EVALUATED }, include: { answers: true, test: true }, take: 20, orderBy: { submittedAt: "desc" } });
  const low = attempts.filter(row => Number(row.percentage ?? 0) < 60);
  const recommendations = low.slice(0, 5).map(row => ({ userId: target, kind: "REVISION", title: `Revise ${row.test.chapter ?? row.test.name}`, reason: `Recent score was ${Number(row.percentage ?? 0).toFixed(1)}%. Review concepts, then attempt a chapter practice test.`, entityType: "LearningTest", entityId: row.testId, priority: Math.round(100 - Number(row.percentage ?? 0)) }));
  if (!recommendations.length) recommendations.push({ userId: target, kind: "PRACTICE", title: "Maintain your learning streak", reason: "Complete today's learning goal and one recommended practice test.", entityType: "GENERAL", entityId: "", priority: 50 });
  await prisma.learningRecommendation.deleteMany({ where: { userId: target, completedAt: null } });
  await prisma.learningRecommendation.createMany({ data: recommendations });
  res.status(201).json({ data: await prisma.learningRecommendation.findMany({ where: { userId: target, completedAt: null }, orderBy: { priority: "desc" } }) });
});

router.patch("/learning/recommendations/:id/complete", allow(Role.STUDENT), async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  if (!actor.learners.length) throw learningDenied();
  const row = await prisma.learningRecommendation.findFirst({ where: { id: String(req.params.id), userId: actor.userId } });
  if (!row) throw new AppError(404, "RECOMMENDATION_NOT_FOUND", "Recommendation not found");
  res.json({ data: await prisma.learningRecommendation.update({ where: { id: row.id }, data: { completedAt: new Date() } }) });
});

router.get("/learning/faculty-insights", allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN, Role.TEACHER), async (req: AuthRequest, res) => {
  const actor = await learningActorForRequest(req);
  const resourceScope = learningResourceWhere(actor, { teacherOwned: actor.role === Role.TEACHER });
  const doubtScope = learningDoubtWhere(actor);
  const attemptScope = learningAttemptStudentWhere(actor);
  const [classes, materials, doubts, tests] = await Promise.all([
    prisma.liveClass.findMany({ where: resourceScope, include: { _count: { select: { attendances: true, interactions: true } } }, take: 20, orderBy: { startsAt: "desc" } }),
    prisma.studyMaterial.count({ where: resourceScope }),
    prisma.doubtThread.count({ where: { ...doubtScope, status: DoubtStatus.ESCALATED } }),
    prisma.learningTestAttempt.aggregate({ where: { ...attemptScope, test: learningResourceWhere(actor), status: LearningAttemptStatus.EVALUATED }, _avg: { percentage: true }, _count: true }),
  ]);
  res.json({ data: { classes, materialsUploaded: materials, escalatedDoubts: doubts, studentPerformance: tests, insight: doubts ? "Resolve escalated doubts before the next class and create a focused practice set." : "Student doubt load is healthy; use low-scoring test topics for the next revision class." } });
});

export default router;
