import { LmsContentStatus, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { activeTeacherLmsAllocations, assertLmsRequestContentAccess, lmsActorForRequest, requireTeacherLmsAllocation, type TeacherLmsAllocation } from "../lib/lms-access.js";
import { AppError } from "../lib/http.js";
import { assertLmsManagementAccess, assertLmsModuleManagementAccess, lmsLessonBranchFilter, lmsModuleCourseWhere, type LmsActor } from "../lib/lms-policy.js";
import { prisma } from "../lib/prisma.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router(), admin = Router();
router.use(requireAuth);
admin.use(requireAuth, allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN, Role.TEACHER));

const file = z.object({ name: z.string().min(1).max(180), mimeType: z.string().min(3), base64: z.string().min(1) });
const input = z.object({
  title: z.string().trim().min(3).max(200), description: z.string().trim().min(3).max(10000), moduleId: z.string().cuid(),
  branchId: z.string().cuid(), courseId: z.string().cuid(), batchId: z.string().cuid(), subjectId: z.string().cuid(), teacherId: z.string().cuid(),
  chapter: z.string().trim().min(2).max(150), videoUrl: z.string().url().refine(value => value.startsWith("https://"), "Video URL must use HTTPS").nullable().optional(),
  notes: z.string().trim().max(20000).nullable().optional(), durationSeconds: z.number().int().positive().max(86400), position: z.number().int().positive(),
  preview: z.boolean().default(false), status: z.nativeEnum(LmsContentStatus).default(LmsContentStatus.DRAFT), homeworkId: z.string().cuid().nullable().optional(),
  testId: z.string().cuid().nullable().optional(), video: file.nullable().optional(), attachments: z.array(file).max(10).optional(),
});
const select = {
  id: true, title: true, description: true, position: true, type: true, videoUrl: true, notes: true, durationSeconds: true, preview: true,
  chapter: true, status: true, videoName: true, videoMime: true, videoSize: true, module: { select: { id: true, title: true, position: true } },
  branch: { select: { id: true, branchName: true } }, course: { select: { id: true, title: true } }, batch: { select: { id: true, name: true, code: true } },
  subject: { select: { id: true, name: true, code: true } }, teacher: { select: { id: true, user: { select: { name: true } } } },
  homework: { select: { id: true, title: true } }, test: { select: { id: true, name: true } }, attachments: { select: { id: true, name: true, mimeType: true, size: true } },
  progress: { select: { id: true, userId: true, watchedSeconds: true, watchPercentage: true, lastPositionSeconds: true, timeSpentSeconds: true, quizScore: true, assignmentStatus: true, completed: true, completedAt: true, user: { select: { name: true, email: true } } } },
} as const;

const shape = (value: any) => ({ ...value, branch: value.branch ? { ...value.branch, name: value.branch.branchName } : null });
const unique = (values: string[]) => [...new Set(values)];
const allocationPairs = (allocations: TeacherLmsAllocation[]) => allocations.map(item => ({ branchId: item.branchId, courseId: item.courseId, batchId: item.batchId, subjectId: item.subjectId }));

function bytes(value: z.infer<typeof file>, max: number, types: string[]) {
  const data = Buffer.from(value.base64, "base64");
  if (!data.length || data.length > max) throw new AppError(422, "INVALID_FILE_SIZE", `File exceeds ${Math.round(max / 1048576)} MB`);
  if (!types.includes(value.mimeType)) throw new AppError(422, "INVALID_FILE_TYPE", "File type is not allowed");
  return data;
}

async function relations(data: z.infer<typeof input>, current: LmsActor) {
  const [batch, courseSubject, teacher, module, homework, test] = await Promise.all([
    prisma.batch.findUnique({ where: { id: data.batchId }, select: { branchId: true, courseId: true, academicSessionId: true } }),
    prisma.courseSubject.findUnique({ where: { courseId_subjectId: { courseId: data.courseId, subjectId: data.subjectId } }, select: { isActive: true } }),
    prisma.teacherProfile.findUnique({ where: { id: data.teacherId }, select: { branchId: true } }),
    prisma.module.findUnique({ where: { id: data.moduleId }, select: { courseId: true } }),
    data.homeworkId ? prisma.homework.findUnique({ where: { id: data.homeworkId }, select: { batchId: true, subjectId: true } }) : null,
    data.testId ? prisma.test.findUnique({ where: { id: data.testId }, select: { courseId: true, batches: { select: { batchId: true } } } }) : null,
  ]);
  if (!batch || batch.branchId !== data.branchId || batch.courseId !== data.courseId) throw new AppError(422, "INVALID_BATCH_RELATION", "Batch must match Branch and Course");
  if (!courseSubject?.isActive) throw new AppError(422, "INVALID_SUBJECT_RELATION", "Subject must belong to Course");
  if (!teacher || teacher.branchId !== data.branchId) throw new AppError(422, "INVALID_TEACHER_RELATION", "Teacher must belong to Branch");
  if (!module || module.courseId !== data.courseId) throw new AppError(422, "INVALID_MODULE_RELATION", "Module must belong to Course");
  if (data.homeworkId && (!homework || homework.batchId !== data.batchId || homework.subjectId !== data.subjectId)) throw new AppError(422, "INVALID_HOMEWORK_LINK", "Homework must match Batch and Subject");
  if (data.testId && (!test || test.courseId !== data.courseId || !test.batches.some(item => item.batchId === data.batchId))) throw new AppError(422, "INVALID_QUIZ_LINK", "Quiz must match Course and Batch");
  await requireTeacherLmsAllocation(current, { ...data, academicSessionId: batch.academicSessionId });
}

function managementWhere(current: LmsActor, allocations: TeacherLmsAllocation[] | null) {
  if (current.role === Role.SUPER_ADMIN) return {};
  if (current.role === Role.TEACHER) return { teacherId: current.teacherProfileId, ...(allocations?.length ? { OR: allocationPairs(allocations) } : { id: { in: [] as string[] } }) };
  return { branchId: { in: current.branchIds } };
}

admin.get("/lms/options", async (req: AuthRequest, res) => {
  const current = await lmsActorForRequest(req), allocations = await activeTeacherLmsAllocations(current);
  const ids = current.role === Role.SUPER_ADMIN ? null : current.branchIds, teacherAllocation = allocations ?? null;
  const branchIds = teacherAllocation ? unique(teacherAllocation.map(item => item.branchId)) : ids;
  const courseIds = teacherAllocation ? unique(teacherAllocation.map(item => item.courseId)) : null;
  const batchIds = teacherAllocation ? unique(teacherAllocation.map(item => item.batchId)) : null;
  const branchWhere = branchIds ? { branchId: { in: branchIds } } : {};
  const pairWhere = teacherAllocation?.length ? { OR: allocationPairs(teacherAllocation) } : teacherAllocation ? { id: { in: [] as string[] } } : branchWhere;
  const moduleWhere = courseIds ? { courseId: { in: courseIds } } : lmsModuleCourseWhere(current);
  const subjectWhere = teacherAllocation?.length ? { isActive: true, OR: teacherAllocation.map(item => ({ courseId: item.courseId, subjectId: item.subjectId })) } : teacherAllocation ? { isActive: true, courseId: { in: [] as string[] } } : { isActive: true };
  const [branches, batches, teachers, subjects, modules, homeworks, tests, students] = await Promise.all([
    prisma.branch.findMany({ where: branchIds ? { id: { in: branchIds } } : {}, select: { id: true, branchName: true } }),
    prisma.batch.findMany({ where: batchIds ? { id: { in: batchIds } } : branchWhere, select: { id: true, name: true, branchId: true, courseId: true, course: { select: { title: true } } } }),
    prisma.teacherProfile.findMany({ where: current.role === Role.TEACHER ? { id: current.teacherProfileId ?? { in: [] as string[] } } : branchWhere, select: { id: true, branchId: true, user: { select: { name: true } } } }),
    prisma.courseSubject.findMany({ where: subjectWhere, select: { courseId: true, subject: { select: { id: true, name: true } } } }),
    prisma.module.findMany({ where: moduleWhere, select: { id: true, title: true, position: true, courseId: true }, orderBy: [{ courseId: "asc" }, { position: "asc" }] }),
    prisma.homework.findMany({ where: pairWhere, select: { id: true, title: true, batchId: true, subjectId: true } }),
    prisma.test.findMany({ where: teacherAllocation?.length ? { OR: teacherAllocation.map(item => ({ branchId: item.branchId, courseId: item.courseId, subjectId: item.subjectId, batches: { some: { batchId: item.batchId } } })) } : teacherAllocation ? { id: { in: [] as string[] } } : branchWhere, select: { id: true, name: true, courseId: true, batches: { select: { batchId: true } } } }),
    prisma.studentProfile.findMany({ where: batchIds ? { batchId: { in: batchIds } } : branchWhere, select: { id: true, userId: true, batchId: true, admissionNo: true, user: { select: { name: true } } } }),
  ]);
  res.json({ data: { branches: branches.map(item => ({ ...item, name: item.branchName })), batches, teachers, subjects, modules, homeworks, tests, students, allocations: teacherAllocation ?? [] } });
});

admin.post("/lms/modules", allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN), async (req: AuthRequest, res) => {
  const data = z.object({ courseId: z.string().cuid(), title: z.string().trim().min(2).max(150), position: z.number().int().positive() }).parse(req.body);
  const current = await lmsActorForRequest(req), course = await prisma.course.findUnique({ where: { id: data.courseId }, select: { branchId: true } });
  if (!course) throw new AppError(422, "INVALID_COURSE_RELATION", "Select a valid Course");
  assertLmsModuleManagementAccess(current, course);
  try { res.status(201).json({ data: await prisma.module.create({ data }) }); }
  catch (error: any) { if (error?.code === "P2002") throw new AppError(409, "MODULE_POSITION_CONFLICT", "A Module already uses this position in the selected Course"); throw error; }
});

admin.get("/lms/dashboard", async (req: AuthRequest, res) => {
  const current = await lmsActorForRequest(req), where = managementWhere(current, await activeTeacherLmsAllocations(current));
  const [lessons, published, archived, students, completed] = await Promise.all([
    prisma.lesson.count({ where: { ...where, courseId: { not: null } } }), prisma.lesson.count({ where: { ...where, status: LmsContentStatus.PUBLISHED } }),
    prisma.lesson.count({ where: { ...where, status: LmsContentStatus.ARCHIVED } }), prisma.lessonProgress.findMany({ where: { lesson: where }, distinct: ["userId"], select: { userId: true } }),
    prisma.lessonProgress.count({ where: { completed: true, lesson: where } }),
  ]);
  res.json({ data: { lessons, published, archived, students: students.length, completed } });
});

admin.get("/lms/lessons", async (req: AuthRequest, res) => {
  const query = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20), search: z.string().optional(), branchId: z.string().cuid().optional(), courseId: z.string().cuid().optional(), batchId: z.string().cuid().optional(), subjectId: z.string().cuid().optional(), teacherId: z.string().cuid().optional(), status: z.nativeEnum(LmsContentStatus).optional(), sortBy: z.enum(["title", "chapter", "position", "durationSeconds", "status", "createdAt"]).default("position"), sortOrder: z.enum(["asc", "desc"]).default("asc") }).parse(req.query);
  const current = await lmsActorForRequest(req), allocations = await activeTeacherLmsAllocations(current), branchId = lmsLessonBranchFilter(current, query.branchId);
  const where: any = {
    courseId: query.courseId ?? { not: null }, ...(branchId ? { branchId } : {}), ...(query.batchId ? { batchId: query.batchId } : {}),
    ...(query.subjectId ? { subjectId: query.subjectId } : {}), ...(query.teacherId ? { teacherId: query.teacherId } : {}),
    ...(current.role === Role.TEACHER ? { teacherId: current.teacherProfileId, ...(allocations?.length ? { AND: [{ OR: allocationPairs(allocations) }] } : { id: { in: [] } }) } : {}),
    ...(query.status ? { status: query.status } : {}), ...(query.search ? { OR: [{ title: { contains: query.search, mode: "insensitive" } }, { chapter: { contains: query.search, mode: "insensitive" } }, { description: { contains: query.search, mode: "insensitive" } }] } : {}),
  };
  const [total, data] = await prisma.$transaction([prisma.lesson.count({ where }), prisma.lesson.findMany({ where, select, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: { [query.sortBy]: query.sortOrder } })]);
  res.json({ data: data.map(shape), meta: { total, page: query.page, limit: query.limit, totalPages: Math.max(1, Math.ceil(total / query.limit)) } });
});

admin.get("/lms/lessons/:id", async (req: AuthRequest, res) => {
  const lesson = await prisma.lesson.findUnique({ where: { id: String(req.params.id) }, select });
  if (!lesson) throw new AppError(404, "LESSON_NOT_FOUND", "Lesson not found");
  await assertLmsRequestContentAccess(req, { branchId: lesson.branch?.id ?? null, courseId: lesson.course?.id ?? null, batchId: lesson.batch?.id ?? null, subjectId: lesson.subject?.id ?? null, teacherId: lesson.teacher?.id ?? null, status: lesson.status });
  res.json({ data: shape(lesson) });
});

admin.post("/lms/lessons", async (req: AuthRequest, res) => {
  const data = input.parse(req.body), current = await lmsActorForRequest(req);
  assertLmsManagementAccess(current, data); await relations(data, current);
  const { video, attachments = [], ...rest } = data, videoData = video ? bytes(video, 25 * 1048576, ["video/mp4", "video/webm"]) : null;
  try {
    const lesson = await prisma.lesson.create({ data: { ...rest, type: video || data.videoUrl ? "VIDEO" : "NOTES", content: data.notes, ...(videoData ? { videoName: video!.name, videoMime: video!.mimeType, videoSize: videoData.length, videoData } : {}), attachments: { create: attachments.map(attachment => { const data = bytes(attachment, 5 * 1048576, ["application/pdf", "image/jpeg", "image/png", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]); return { name: attachment.name, mimeType: attachment.mimeType, size: data.length, data }; }) } }, select });
    res.status(201).json({ data: shape(lesson) });
  } catch (error: any) { if (error.code === "P2002") throw new AppError(409, "DUPLICATE_LESSON_OR_ORDER", "Lesson title or order already exists in this Chapter/Module"); throw error; }
});

admin.patch("/lms/lessons/:id", async (req: AuthRequest, res) => {
  const old = await prisma.lesson.findUnique({ where: { id: String(req.params.id) }, select: { id: true, moduleId: true, branchId: true, courseId: true, batchId: true, subjectId: true, teacherId: true, chapter: true, durationSeconds: true, position: true, status: true } });
  if (!old) throw new AppError(404, "LESSON_NOT_FOUND", "Lesson not found");
  const current = await lmsActorForRequest(req), patch = input.partial().parse(req.body), data = { ...old, ...patch } as z.infer<typeof input>;
  await assertLmsRequestContentAccess(req, old); assertLmsManagementAccess(current, data); await relations(data, current);
  const { video, attachments, ...rest } = patch, videoData = video ? bytes(video, 25 * 1048576, ["video/mp4", "video/webm"]) : null;
  try {
    const lesson = await prisma.lesson.update({ where: { id: old.id }, data: { ...rest, ...(videoData ? { videoName: video!.name, videoMime: video!.mimeType, videoSize: videoData.length, videoData } : {}), ...(attachments ? { attachments: { create: attachments.map(attachment => { const data = bytes(attachment, 5 * 1048576, ["application/pdf", "image/jpeg", "image/png", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]); return { name: attachment.name, mimeType: attachment.mimeType, size: data.length, data }; }) } } : {}) }, select });
    res.json({ data: shape(lesson) });
  } catch (error: any) { if (error.code === "P2002") throw new AppError(409, "DUPLICATE_LESSON_OR_ORDER", "Lesson title or order already exists"); throw error; }
});

admin.patch("/lms/lessons/:id/status", async (req: AuthRequest, res) => {
  const old = await prisma.lesson.findUnique({ where: { id: String(req.params.id) }, select: { id: true, branchId: true, courseId: true, batchId: true, subjectId: true, teacherId: true, status: true } });
  if (!old) throw new AppError(404, "LESSON_NOT_FOUND", "Lesson not found");
  await assertLmsRequestContentAccess(req, old);
  const { status } = z.object({ status: z.nativeEnum(LmsContentStatus) }).parse(req.body);
  res.json({ data: shape(await prisma.lesson.update({ where: { id: old.id }, data: { status }, select })) });
});

admin.delete("/lms/lessons/:id", async (req: AuthRequest, res) => {
  const lesson = await prisma.lesson.findUnique({ where: { id: String(req.params.id) }, select: { id: true, branchId: true, courseId: true, batchId: true, subjectId: true, teacherId: true, status: true, _count: { select: { progress: true } } } });
  if (!lesson) throw new AppError(404, "LESSON_NOT_FOUND", "Lesson not found");
  await assertLmsRequestContentAccess(req, lesson);
  if (lesson.status !== LmsContentStatus.ARCHIVED) throw new AppError(409, "ARCHIVE_BEFORE_DELETE", "Archive lesson before deleting it");
  if (lesson._count.progress) throw new AppError(409, "LESSON_HAS_PROGRESS", "Lessons with student progress cannot be deleted");
  await prisma.lesson.delete({ where: { id: lesson.id } }); res.status(204).send();
});

router.get("/lms/lessons/:id/video", async (req: AuthRequest, res) => {
  const lesson = await prisma.lesson.findUnique({ where: { id: String(req.params.id) }, select: { branchId: true, courseId: true, batchId: true, subjectId: true, teacherId: true, status: true, videoData: true, videoMime: true, videoSize: true, videoUrl: true } });
  if (!lesson) throw new AppError(404, "LESSON_NOT_FOUND", "Lesson not found");
  await assertLmsRequestContentAccess(req, lesson);
  if (!lesson.videoData && lesson.videoUrl) return res.redirect(lesson.videoUrl);
  if (!lesson.videoData) throw new AppError(404, "VIDEO_NOT_FOUND", "Video not found");
  const data = Buffer.from(lesson.videoData), range = req.headers.range;
  if (!range) { res.set({ "Content-Type": lesson.videoMime!, "Content-Length": String(data.length), "Accept-Ranges": "bytes" }); return res.send(data); }
  const match = /bytes=(\d+)-(\d*)/.exec(range); if (!match) return res.status(416).send();
  const start = Number(match[1]), end = match[2] ? Math.min(Number(match[2]), data.length - 1) : data.length - 1;
  if (start > end || start >= data.length) return res.status(416).send();
  res.status(206).set({ "Content-Type": lesson.videoMime!, "Content-Range": `bytes ${start}-${end}/${data.length}`, "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes" }).send(data.subarray(start, end + 1));
});

router.get("/lms/attachments/:id", async (req: AuthRequest, res) => {
  const attachment = await prisma.lessonAttachment.findUnique({ where: { id: String(req.params.id) }, include: { lesson: { select: { branchId: true, courseId: true, batchId: true, subjectId: true, teacherId: true, status: true } } } });
  if (!attachment) throw new AppError(404, "FILE_NOT_FOUND", "File not found");
  await assertLmsRequestContentAccess(req, attachment.lesson);
  res.set({ "Content-Type": attachment.mimeType, "Content-Disposition": `attachment; filename="${attachment.name.replace(/["\r\n]/g, "")}"` }).send(Buffer.from(attachment.data));
});

router.patch("/lms/lessons/:id/progress", allow(Role.STUDENT), async (req: AuthRequest, res) => {
  const lesson = await prisma.lesson.findUnique({ where: { id: String(req.params.id) }, select: { id: true, branchId: true, courseId: true, batchId: true, subjectId: true, teacherId: true, status: true, durationSeconds: true } });
  if (!lesson) throw new AppError(404, "LESSON_NOT_FOUND", "Lesson not found");
  await assertLmsRequestContentAccess(req, lesson);
  const data = z.object({ lastPositionSeconds: z.number().int().min(0), timeSpentSeconds: z.number().int().min(0).max(86400), quizScore: z.number().min(0).max(100).nullable().optional(), assignmentStatus: z.string().max(50).nullable().optional(), completed: z.boolean().optional() }).parse(req.body);
  const watchedSeconds = Math.min(data.lastPositionSeconds, lesson.durationSeconds), watchPercentage = lesson.durationSeconds ? Math.min(100, Math.round(watchedSeconds / lesson.durationSeconds * 100)) : 0, completed = data.completed ?? watchPercentage >= 90;
  const progress = await prisma.lessonProgress.upsert({ where: { userId_lessonId: { userId: req.auth!.userId, lessonId: lesson.id } }, update: { watchedSeconds, watchPercentage, lastPositionSeconds: watchedSeconds, timeSpentSeconds: { increment: data.timeSpentSeconds }, quizScore: data.quizScore, assignmentStatus: data.assignmentStatus, completed, ...(completed ? { completedAt: new Date() } : {}) }, create: { userId: req.auth!.userId, lessonId: lesson.id, watchedSeconds, watchPercentage, lastPositionSeconds: watchedSeconds, timeSpentSeconds: data.timeSpentSeconds, quizScore: data.quizScore, assignmentStatus: data.assignmentStatus, completed, ...(completed ? { completedAt: new Date() } : {}) } });
  res.json({ data: progress });
});

router.get("/lms/me", allow(Role.STUDENT), async (req: AuthRequest, res) => {
  const student = await prisma.studentProfile.findUnique({ where: { userId: req.auth!.userId }, select: { batchId: true, status: true, batch: { select: { courseId: true } } } });
  if (!student || student.status !== "ACTIVE") throw new AppError(403, "STUDENT_INACTIVE", "An active Student profile is required");
  const lessons = await prisma.lesson.findMany({ where: { batchId: student.batchId, status: LmsContentStatus.PUBLISHED }, select: { ...select, progress: { where: { userId: req.auth!.userId }, select: { watchedSeconds: true, watchPercentage: true, lastPositionSeconds: true, timeSpentSeconds: true, completed: true, updatedAt: true } } }, orderBy: [{ module: { position: "asc" } }, { position: "asc" }] });
  const total = lessons.length, completed = lessons.filter((lesson: any) => lesson.progress[0]?.completed).length, percentage = total ? Math.round(completed / total * 100) : 0;
  const continueLesson = lessons.filter((lesson: any) => !lesson.progress[0]?.completed).sort((a: any, b: any) => new Date(b.progress[0]?.updatedAt ?? 0).getTime() - new Date(a.progress[0]?.updatedAt ?? 0).getTime())[0] ?? null;
  res.json({ data: { lessons: lessons.map(shape), summary: { total, completed, percentage, certificateEligible: total > 0 && percentage >= 80, continueLesson } } });
});

export { router as lmsLearning };
export default admin;
