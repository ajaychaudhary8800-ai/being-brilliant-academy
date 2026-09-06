import { HomeworkStatus, Role, TeacherAllocationStatus, TimetableStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import {
  assertActiveTeacherHomeworkUser,
  assertHomeworkManagerAccess,
  assertTeacherHomeworkEditable,
  assertTeacherHomeworkEvaluationOpen,
  assertTeacherHomeworkTransition,
  authenticatedTeacherHomeworkId,
  currentTeacherHomeworkAllocationContext,
  teacherHomeworkCreateStatus,
} from "../lib/homework-policy.js";
import { AppError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { allocatedSubjects, requireAllocatedSubject } from "../lib/subject-resolution.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";
import homeworks from "./homeworks.js";

const router = Router();
router.use(requireAuth, allow(Role.TEACHER));

const id = z.string().cuid();
const contextInput = z.object({
  branchId: id,
  courseId: id,
  batchId: id,
  subjectId: id,
});

async function teacherForRequest(req: AuthRequest) {
  const teacher = await prisma.teacherProfile.findFirst({
    where: { userId: req.auth!.userId, organizationId: req.auth!.organizationId },
    select: { id: true, organizationId: true, branchId: true, user: { select: { name: true, isActive: true } } },
  });
  if (!teacher) throw new AppError(403, "TEACHER_PROFILE_REQUIRED", "Teacher profile is required");
  assertActiveTeacherHomeworkUser(teacher.user.isActive);
  return teacher;
}

router.use(async (req: AuthRequest, _res, next) => {
  await teacherForRequest(req);
  next();
});

async function assertAllocatedContext(req: AuthRequest, teacher: Awaited<ReturnType<typeof teacherForRequest>>, context: z.infer<typeof contextInput>) {
  const batch = await prisma.batch.findFirst({
    where: { id: context.batchId, organizationId: req.auth!.organizationId },
    select: { branchId: true, courseId: true, academicSessionId: true },
  });
  if (!batch || batch.branchId !== context.branchId || batch.courseId !== context.courseId || teacher.branchId !== context.branchId) {
    throw new AppError(422, "INVALID_TEACHER_HOMEWORK_CONTEXT", "Select a course and batch from your assigned academic scope");
  }
  await requireAllocatedSubject(currentTeacherHomeworkAllocationContext({
    branchId: context.branchId,
    courseId: context.courseId,
    batchId: context.batchId,
    teacherId: teacher.id,
    academicSessionId: batch.academicSessionId,
    subjectId: context.subjectId,
  }));
}

async function homeworkForTeacher(req: AuthRequest, homeworkId: string) {
  const teacher = await teacherForRequest(req);
  const homework = await prisma.homework.findFirst({
    where: { id: homeworkId, organizationId: req.auth!.organizationId },
    select: { organizationId: true, teacherId: true, branchId: true, courseId: true, batchId: true, subjectId: true, status: true },
  });
  if (!homework) throw new AppError(404, "HOMEWORK_NOT_FOUND", "Homework not found");
  assertHomeworkManagerAccess({
    role: Role.TEACHER,
    requestOrganizationId: req.auth!.organizationId,
    homeworkOrganizationId: homework.organizationId,
    homeworkTeacherId: homework.teacherId,
    authenticatedTeacherId: teacher.id,
    branchAllowed: homework.branchId === teacher.branchId,
  });
  return { teacher, homework };
}

async function submissionForTeacher(req: AuthRequest, submissionId: string) {
  const teacher = await teacherForRequest(req);
  const submission = await prisma.homeworkSubmission.findFirst({
    where: { id: submissionId, organizationId: req.auth!.organizationId },
    select: { status: true, homework: { select: { organizationId: true, teacherId: true, branchId: true, courseId: true, batchId: true, subjectId: true, status: true } } },
  });
  if (!submission) throw new AppError(404, "SUBMISSION_NOT_FOUND", "Submission not found");
  assertHomeworkManagerAccess({
    role: Role.TEACHER,
    requestOrganizationId: req.auth!.organizationId,
    homeworkOrganizationId: submission.homework.organizationId,
    homeworkTeacherId: submission.homework.teacherId,
    authenticatedTeacherId: teacher.id,
    branchAllowed: submission.homework.branchId === teacher.branchId,
  });
  return { teacher, submission };
}

router.get("/homeworks/options", async (req: AuthRequest, res) => {
  const teacher = await teacherForRequest(req);
  const effectiveAt = new Date();
  const allocationContexts = await prisma.teacherAllocation.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      teacherId: teacher.id,
      status: TeacherAllocationStatus.ACTIVE,
      effectiveFrom: { lte: effectiveAt },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveAt } }],
    },
    select: {
      branchId: true,
      courseId: true,
      batchId: true,
      academicSessionId: true,
      branch: { select: { id: true, branchName: true, branchCode: true } },
      course: { select: { id: true, title: true, courseCode: true } },
      batch: { select: { id: true, name: true, code: true, branchId: true, courseId: true, academicSession: true, academicSessionId: true, course: { select: { title: true } } } },
    },
    orderBy: [{ course: { title: "asc" } }, { batch: { name: "asc" } }],
  });
  const uniqueContexts = [...new Map(allocationContexts.map(context => [`${context.branchId}:${context.courseId}:${context.batchId}:${context.academicSessionId}`, context])).values()];
  const resolved = await Promise.all(uniqueContexts.map(async context => ({
    context,
    subjects: await allocatedSubjects({
      branchId: context.branchId,
      courseId: context.courseId,
      batchId: context.batchId,
      teacherId: teacher.id,
      academicSessionId: context.academicSessionId,
      effectiveAt,
    }),
  })));
  const valid = resolved.filter(item => item.subjects.length > 0);
  const validBatchIds = [...new Set(valid.map(item => item.context.batchId))];
  const timetable = await prisma.timetable.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      teacherId: teacher.id,
      batchId: { in: validBatchIds },
      status: { not: TimetableStatus.ARCHIVED },
    },
    select: { id: true, branchId: true, courseId: true, batchId: true, subjectId: true, teacherId: true, day: true, startMinute: true, endMinute: true, periodNumber: true },
  });
  const branches = [...new Map(valid.map(item => [item.context.branch.id, { ...item.context.branch, name: item.context.branch.branchName, code: item.context.branch.branchCode }])).values()];
  const batches = [...new Map(valid.map(item => [item.context.batch.id, item.context.batch])).values()];
  const subjects = [...new Map(valid.flatMap(item => item.subjects.map(subject => [`${item.context.courseId}:${subject.id}`, { courseId: item.context.courseId, subject }]))).values()];
  const allowedTimetables = timetable.filter(period => valid.some(item => item.context.batchId === period.batchId && item.subjects.some(subject => subject.id === period.subjectId)));
  res.json({ data: {
    branches,
    batches,
    teachers: [{ id: teacher.id, branchId: teacher.branchId, user: teacher.user }],
    subjects,
    timetables: allowedTimetables,
    students: [],
  }, meta: { reason: valid.length ? null : "NO_EFFECTIVE_TEACHER_ALLOCATION" } });
});

router.post("/homeworks", async (req: AuthRequest, _res, next) => {
  const teacher = await teacherForRequest(req);
  req.body = {
    ...req.body,
    teacherId: authenticatedTeacherHomeworkId(teacher.id, req.body?.teacherId),
    status: teacherHomeworkCreateStatus(req.body?.status),
  };
  await assertAllocatedContext(req, teacher, contextInput.parse(req.body));
  next();
});

router.patch("/homeworks/:homeworkId", async (req: AuthRequest, _res, next) => {
  const { teacher, homework } = await homeworkForTeacher(req, id.parse(req.params.homeworkId));
  assertTeacherHomeworkEditable(homework.status);
  if (req.body?.status && req.body.status !== homework.status) {
    throw new AppError(422, "USE_HOMEWORK_STATUS_ACTION", "Use the publish or close action to change Homework status");
  }
  req.body = { ...req.body, teacherId: authenticatedTeacherHomeworkId(teacher.id, req.body?.teacherId) };
  const patch = contextInput.partial().parse(req.body);
  await assertAllocatedContext(req, teacher, {
    branchId: patch.branchId ?? homework.branchId,
    courseId: patch.courseId ?? homework.courseId,
    batchId: patch.batchId ?? homework.batchId,
    subjectId: patch.subjectId ?? homework.subjectId,
  });
  next();
});

router.patch("/homeworks/:homeworkId/status", async (req: AuthRequest, _res, next) => {
  const { teacher, homework } = await homeworkForTeacher(req, id.parse(req.params.homeworkId));
  const status = z.nativeEnum(HomeworkStatus).parse(req.body?.status);
  assertTeacherHomeworkTransition(homework.status, status);
  await assertAllocatedContext(req, teacher, homework);
  req.body = { ...req.body, expectedStatus: homework.status };
  next();
});

router.get("/homeworks/:homeworkId", async (req: AuthRequest, _res, next) => {
  if (["dashboard", "export", "options"].includes(String(req.params.homeworkId))) return next();
  await homeworkForTeacher(req, id.parse(req.params.homeworkId));
  next();
});

router.get("/homeworks/:homeworkId/attachment", async (req: AuthRequest, _res, next) => {
  await homeworkForTeacher(req, id.parse(req.params.homeworkId));
  next();
});

router.get("/homeworks/submissions/:submissionId/attachment", async (req: AuthRequest, _res, next) => {
  await submissionForTeacher(req, id.parse(req.params.submissionId));
  next();
});

router.patch("/homeworks/submissions/:submissionId/evaluate", async (req: AuthRequest, _res, next) => {
  const { teacher, submission } = await submissionForTeacher(req, id.parse(req.params.submissionId));
  assertTeacherHomeworkEvaluationOpen(submission.homework.status);
  await assertAllocatedContext(req, teacher, submission.homework);
  next();
});

router.delete("/homeworks/:homeworkId", () => {
  throw new AppError(403, "FORBIDDEN", "Teachers cannot delete homework");
});

router.use(homeworks);

export default router;
