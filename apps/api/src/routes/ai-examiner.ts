import { AIExaminerRubricStatus, ExaminationStatus, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config.js";
import { assertAIExaminerRubricActivatable } from "../lib/ai-examiner-policy.js";
import { assertExaminationManager } from "../lib/examination-policy.js";
import { AppError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";
import { requireCommercialFeature } from "../middleware/commercial-entitlement.js";

const router = Router();
router.use(requireAuth, allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN, Role.TEACHER), requireCommercialFeature("examinations"));

const cuid = z.string().cuid();
const rubricInput = z.object({
  instructions: z.string().trim().max(5000).nullable().optional(),
  questions: z.array(z.object({
    key: z.string().trim().min(1).max(40),
    maxMarks: z.coerce.number().positive().max(10000),
    criteria: z.string().trim().min(2).max(4000),
    modelAnswer: z.string().trim().max(12000).nullable().optional(),
    concepts: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  })).min(1).max(200),
}).superRefine((value, ctx) => {
  const keys = new Set<string>();
  value.questions.forEach((question, index) => {
    const normalized = question.key.toLowerCase();
    if (keys.has(normalized)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["questions", index, "key"], message: "Question keys must be unique" });
    keys.add(normalized);
  });
});

async function branchAccess(req: AuthRequest, branchId: string) {
  if (req.auth!.role !== Role.BRANCH_ADMIN) return;
  const found = await prisma.branchUser.findFirst({
    where: { organizationId: req.auth!.organizationId, userId: req.auth!.userId, branchId },
    select: { branchId: true },
  });
  if (!found) throw new AppError(403, "BRANCH_FORBIDDEN", "Branch access denied");
}

async function examinationForManager(req: AuthRequest, examinationId: string) {
  const exam = await prisma.examination.findFirst({
    where: { organizationId: req.auth!.organizationId, id: examinationId },
    include: {
      teacher: { select: { id: true, userId: true, user: { select: { name: true } } } },
      subject: { select: { id: true, name: true } },
      batch: { select: { id: true, name: true } },
      branch: { select: { id: true, branchName: true } },
      questionPaper: { select: { id: true, fileName: true, publishedAt: true } },
      aiExaminerRubrics: { orderBy: { version: "desc" }, take: 20 },
      _count: { select: { answerSheets: true } },
    },
  });
  if (!exam) throw new AppError(404, "EXAMINATION_NOT_FOUND", "Examination not found");
  await branchAccess(req, exam.branchId);
  assertExaminationManager(req.auth!.role, req.auth!.userId, exam.teacher.userId);
  if (req.auth!.role === Role.TEACHER) {
    const allocation = await prisma.teacherAllocation.findFirst({
      where: {
        organizationId: req.auth!.organizationId,
        branchId: exam.branchId,
        academicSessionId: exam.academicSessionId,
        courseId: exam.courseId,
        batchId: exam.batchId,
        subjectId: exam.subjectId,
        teacherId: exam.teacherId,
        status: "ACTIVE",
        effectiveFrom: { lte: exam.examDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: exam.examDate } }],
        branch: { isActive: true },
        academicSession: { isArchived: false },
        batch: { status: "ACTIVE" },
        teacher: { user: { isActive: true } },
      },
      select: { id: true },
    });
    if (!allocation) throw new AppError(403, "EXAMINATION_ALLOCATION_REQUIRED", "An effective TeacherAllocation is required for this examination");
  }
  return exam;
}

function rubricMarks(rubric: unknown) {
  const parsed = z.object({ questions: z.array(z.object({ maxMarks: z.coerce.number() })) }).safeParse(rubric);
  return parsed.success ? parsed.data.questions.reduce((sum, question) => sum + question.maxMarks, 0) : 0;
}

function readiness(exam: Awaited<ReturnType<typeof examinationForManager>>, evaluated: number) {
  const activeRubric = exam.aiExaminerRubrics.find((rubric) => rubric.status === AIExaminerRubricStatus.ACTIVE) ?? null;
  const draftRubric = exam.aiExaminerRubrics.find((rubric) => rubric.status === AIExaminerRubricStatus.DRAFT) ?? null;
  const blockers: string[] = [];
  if (exam.status !== ExaminationStatus.COMPLETED) blockers.push("Complete the examination before AI evaluation");
  if (!exam.questionPaper?.publishedAt) blockers.push("Publish the question paper");
  if (!activeRubric) blockers.push("Activate a marking rubric");
  if (!exam._count.answerSheets) blockers.push("No answer sheets have been submitted");
  return {
    examination: {
      id: exam.id,
      name: exam.name,
      code: exam.code,
      status: exam.status,
      maximumMarks: exam.maximumMarks,
      subject: exam.subject,
      batch: exam.batch,
      branch: exam.branch,
      teacher: { id: exam.teacher.id, name: exam.teacher.user.name },
    },
    questionPaper: exam.questionPaper,
    activeRubric,
    draftRubric,
    answerSheets: { total: exam._count.answerSheets, withAIEvaluation: evaluated },
    setupReady: blockers.length === 0,
    blockers,
    engine: {
      providerConfigured: Boolean(env.AI_PROVIDER_URL && env.AI_API_KEY),
      model: env.AI_MODEL,
      evaluationExecutionAvailable: false,
      phase: "FOUNDATION",
    },
  };
}

router.get("/capabilities", async (_req, res) => {
  res.json({ data: { providerConfigured: Boolean(env.AI_PROVIDER_URL && env.AI_API_KEY), model: env.AI_MODEL, evaluationExecutionAvailable: false, phase: "FOUNDATION" } });
});

router.get("/examinations", async (req: AuthRequest, res) => {
  const teacher = req.auth!.role === Role.TEACHER ? await prisma.teacherProfile.findFirst({ where: { organizationId: req.auth!.organizationId, userId: req.auth!.userId }, select: { id: true } }) : null;
  const branchIds = req.auth!.role === Role.BRANCH_ADMIN ? (await prisma.branchUser.findMany({ where: { organizationId: req.auth!.organizationId, userId: req.auth!.userId }, select: { branchId: true } })).map(row => row.branchId) : null;
  const rows = await prisma.examination.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      status: { not: ExaminationStatus.ARCHIVED },
      ...(teacher ? { teacherId: teacher.id } : {}),
      ...(branchIds ? { branchId: { in: branchIds } } : {}),
    },
    select: {
      id: true, name: true, code: true, status: true, maximumMarks: true, examDate: true,
      subject: { select: { name: true } }, batch: { select: { name: true } }, branch: { select: { branchName: true } },
      questionPaper: { select: { id: true, publishedAt: true } },
      aiExaminerRubrics: { where: { status: { in: [AIExaminerRubricStatus.DRAFT, AIExaminerRubricStatus.ACTIVE] } }, select: { id: true, version: true, status: true }, orderBy: { version: "desc" }, take: 2 },
      _count: { select: { answerSheets: true } },
    },
    orderBy: [{ examDate: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  res.json({ data: rows });
});

router.get("/examinations/:examinationId/readiness", async (req: AuthRequest, res) => {
  const exam = await examinationForManager(req, cuid.parse(req.params.examinationId));
  const evaluated = await prisma.aIExaminerEvaluation.count({ where: { organizationId: req.auth!.organizationId, answerSheet: { examinationId: exam.id } } });
  res.json({ data: readiness(exam, evaluated) });
});

router.put("/examinations/:examinationId/rubric", async (req: AuthRequest, res) => {
  const exam = await examinationForManager(req, cuid.parse(req.params.examinationId));
  if (exam.status === ExaminationStatus.ARCHIVED) throw new AppError(409, "AI_EXAMINER_EXAM_ARCHIVED", "Archived examinations cannot edit AI Examiner rubrics");
  const input = rubricInput.parse(req.body);
  const rubric = { questions: input.questions.map(({ modelAnswer, ...question }) => question) };
  const modelAnswer = { questions: input.questions.filter(question => question.modelAnswer).map(question => ({ key: question.key, answer: question.modelAnswer })) };
  const existingDraft = exam.aiExaminerRubrics.find((value) => value.status === AIExaminerRubricStatus.DRAFT);
  const nextVersion = Math.max(0, ...exam.aiExaminerRubrics.map(value => value.version)) + 1;
  const data = existingDraft
    ? await prisma.aIExaminerRubric.update({ where: { id: existingDraft.id }, data: { instructions: input.instructions ?? null, rubric, modelAnswer }, select: { id: true, version: true, status: true, instructions: true, rubric: true, modelAnswer: true, updatedAt: true } })
    : await prisma.aIExaminerRubric.create({ data: { organizationId: req.auth!.organizationId, examinationId: exam.id, version: nextVersion, instructions: input.instructions ?? null, rubric, modelAnswer, createdById: req.auth!.userId }, select: { id: true, version: true, status: true, instructions: true, rubric: true, modelAnswer: true, updatedAt: true } });
  await prisma.auditLog.create({ data: { organizationId: req.auth!.organizationId, actorId: req.auth!.userId, action: existingDraft ? "AI_EXAMINER_RUBRIC_UPDATED" : "AI_EXAMINER_RUBRIC_CREATED", entity: "AIExaminerRubric", entityId: data.id, metadata: { examinationId: exam.id, version: data.version } } }).catch(() => null);
  res.json({ data });
});

router.post("/examinations/:examinationId/rubrics/:rubricId/activate", async (req: AuthRequest, res) => {
  const exam = await examinationForManager(req, cuid.parse(req.params.examinationId));
  const rubricId = cuid.parse(req.params.rubricId);
  const rubric = await prisma.aIExaminerRubric.findFirst({ where: { id: rubricId, organizationId: req.auth!.organizationId, examinationId: exam.id } });
  if (!rubric) throw new AppError(404, "AI_EXAMINER_RUBRIC_NOT_FOUND", "AI Examiner rubric not found");
  assertAIExaminerRubricActivatable({ status: rubric.status, examinationStatus: exam.status, maximumMarks: exam.maximumMarks, rubricMaximumMarks: rubricMarks(rubric.rubric) });
  const now = new Date();
  const activated = await prisma.$transaction(async (tx) => {
    await tx.aIExaminerRubric.updateMany({ where: { organizationId: req.auth!.organizationId, examinationId: exam.id, status: AIExaminerRubricStatus.ACTIVE, id: { not: rubric.id } }, data: { status: AIExaminerRubricStatus.ARCHIVED } });
    const value = await tx.aIExaminerRubric.update({ where: { id: rubric.id }, data: { status: AIExaminerRubricStatus.ACTIVE, approvedById: req.auth!.userId, approvedAt: now }, select: { id: true, version: true, status: true, approvedAt: true } });
    await tx.auditLog.create({ data: { organizationId: req.auth!.organizationId, actorId: req.auth!.userId, action: "AI_EXAMINER_RUBRIC_ACTIVATED", entity: "AIExaminerRubric", entityId: value.id, metadata: { examinationId: exam.id, version: value.version } } });
    return value;
  });
  res.json({ data: activated });
});

router.get("/answer-sheets/:answerSheetId/evaluations", async (req: AuthRequest, res) => {
  const answerSheetId = cuid.parse(req.params.answerSheetId);
  const sheet = await prisma.examinationAnswerSheet.findFirst({
    where: { id: answerSheetId, organizationId: req.auth!.organizationId },
    include: { examination: { include: { teacher: { select: { userId: true } } } } },
  });
  if (!sheet) throw new AppError(404, "ANSWER_SHEET_NOT_FOUND", "Answer sheet not found");
  await branchAccess(req, sheet.examination.branchId);
  assertExaminationManager(req.auth!.role, req.auth!.userId, sheet.examination.teacher.userId);
  const data = await prisma.aIExaminerEvaluation.findMany({
    where: { organizationId: req.auth!.organizationId, answerSheetId },
    select: {
      id: true, revision: true, status: true, engineVersion: true, provider: true, model: true,
      suggestedMarks: true, confidence: true, feedback: true, errorCode: true, errorMessage: true,
      startedAt: true, completedAt: true, reviewedAt: true, createdAt: true,
      rubric: { select: { id: true, version: true, status: true } },
      _count: { select: { questions: true } },
    },
    orderBy: { revision: "desc" },
  });
  res.json({ data });
});

export default router;
