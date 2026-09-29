import { AIExaminerEvaluationStatus, AIExaminerRubricStatus, AnswerSheetStatus, ExaminationStatus, Prisma, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config.js";
import { AI_EXAMINER_ENGINE_VERSION, AI_EXAMINER_REVIEW_THRESHOLD, aiExaminerProviderConfigured, aiExaminerProviderMode } from "../lib/ai-examiner-engine.js";
import { AI_EXAMINER_ENGINES, AI_EXAMINER_QUESTION_TYPES } from "../lib/ai-examiner-assessment-router.js";
import { aiExaminerRubricInputSchema, aiExaminerRubricStorage } from "../lib/ai-examiner-question-config.js";
import { aiExaminerLifecycleBlocker, assertAIExaminerEvaluationReady, assertAIExaminerReviewable, assertAIExaminerRubricActivatable } from "../lib/ai-examiner-policy.js";
import { assertExaminationManager, evaluationStatus, examinationResultFor } from "../lib/examination-policy.js";
import { AppError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";
import { requireCommercialFeature } from "../middleware/commercial-entitlement.js";

const router = Router();
router.use(requireAuth, allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN, Role.TEACHER), requireCommercialFeature("examinations"));

const cuid = z.string().cuid();
const rubricInput = aiExaminerRubricInputSchema;

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
      answerSheets: {
        select: {
          id: true, fileName: true, mimeType: true, status: true, isLate: true, submittedAt: true, finalizedAt: true, marksObtained: true,
          student: { select: { id: true, admissionNo: true, rollNo: true, user: { select: { name: true } } } },
          aiEvaluations: { select: { id: true, revision: true, status: true, suggestedMarks: true, confidence: true, errorCode: true, errorMessage: true, createdAt: true, completedAt: true }, orderBy: { revision: "desc" }, take: 1 },
        },
        orderBy: { submittedAt: "asc" },
        take: 200,
      },
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

async function answerSheetForManager(req: AuthRequest, answerSheetId: string) {
  const sheet = await prisma.examinationAnswerSheet.findFirst({
    where: { id: answerSheetId, organizationId: req.auth!.organizationId },
    include: {
      student: { select: { id: true, admissionNo: true, rollNo: true, user: { select: { name: true } } } },
    },
  });
  if (!sheet) throw new AppError(404, "ANSWER_SHEET_NOT_FOUND", "Answer sheet not found");
  const exam = await examinationForManager(req, sheet.examinationId);
  return { sheet, exam };
}

function rubricMarks(rubric: unknown) {
  const parsed = z.object({ questions: z.array(z.object({ maxMarks: z.coerce.number() })) }).safeParse(rubric);
  return parsed.success ? parsed.data.questions.reduce((sum, question) => sum + question.maxMarks, 0) : 0;
}

function readiness(exam: Awaited<ReturnType<typeof examinationForManager>>, evaluated: number) {
  const activeRubric = exam.aiExaminerRubrics.find((rubric) => rubric.status === AIExaminerRubricStatus.ACTIVE) ?? null;
  const draftRubric = exam.aiExaminerRubrics.find((rubric) => rubric.status === AIExaminerRubricStatus.DRAFT) ?? null;
  const blockers: string[] = [];
  const lifecycleBlocker = aiExaminerLifecycleBlocker(exam.status);
  if (lifecycleBlocker) blockers.push(lifecycleBlocker);
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
      providerConfigured: aiExaminerProviderConfigured(),
      providerMode: aiExaminerProviderMode(),
      model: env.AI_EXAMINER_MODEL,
      engineVersion: AI_EXAMINER_ENGINE_VERSION,
      reviewThreshold: AI_EXAMINER_REVIEW_THRESHOLD,
      evaluationExecutionAvailable: aiExaminerProviderConfigured(),
      questionTypes: AI_EXAMINER_QUESTION_TYPES,
      engines: AI_EXAMINER_ENGINES,
      phase: "EVALUATION_ENGINE",
    },
    answerSheetItems: exam.answerSheets.map(sheet => ({
      id: sheet.id,
      fileName: sheet.fileName,
      mimeType: sheet.mimeType,
      status: sheet.status,
      isLate: sheet.isLate,
      submittedAt: sheet.submittedAt,
      finalizedAt: sheet.finalizedAt,
      marksObtained: sheet.marksObtained,
      student: { id: sheet.student.id, admissionNo: sheet.student.admissionNo, rollNo: sheet.student.rollNo, name: sheet.student.user.name },
      latestEvaluation: sheet.aiEvaluations[0] ?? null,
    })),
  };
}

router.get("/capabilities", async (_req, res) => {
  res.json({ data: { providerConfigured: aiExaminerProviderConfigured(), providerMode: aiExaminerProviderMode(), model: env.AI_EXAMINER_MODEL, engineVersion: AI_EXAMINER_ENGINE_VERSION, reviewThreshold: AI_EXAMINER_REVIEW_THRESHOLD, evaluationExecutionAvailable: aiExaminerProviderConfigured(), questionTypes: AI_EXAMINER_QUESTION_TYPES, engines: AI_EXAMINER_ENGINES, phase: "EVALUATION_ENGINE" } });
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
  const { rubric, modelAnswer } = aiExaminerRubricStorage(input);
  const existingDraft = exam.aiExaminerRubrics.find((value) => value.status === AIExaminerRubricStatus.DRAFT);
  const nextVersion = Math.max(0, ...exam.aiExaminerRubrics.map(value => value.version)) + 1;
  const data = existingDraft
    ? await prisma.aIExaminerRubric.update({ where: { id: existingDraft.id }, data: { instructions: input.instructions ?? null, rubric: rubric as Prisma.InputJsonValue, modelAnswer: modelAnswer as Prisma.InputJsonValue }, select: { id: true, version: true, status: true, instructions: true, rubric: true, modelAnswer: true, updatedAt: true } })
    : await prisma.aIExaminerRubric.create({ data: { organizationId: req.auth!.organizationId, examinationId: exam.id, version: nextVersion, instructions: input.instructions ?? null, rubric: rubric as Prisma.InputJsonValue, modelAnswer: modelAnswer as Prisma.InputJsonValue, createdById: req.auth!.userId }, select: { id: true, version: true, status: true, instructions: true, rubric: true, modelAnswer: true, updatedAt: true } });
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

router.post("/answer-sheets/:answerSheetId/evaluate", async (req: AuthRequest, res) => {
  if (!aiExaminerProviderConfigured()) throw new AppError(503, "AI_EXAMINER_PROVIDER_NOT_CONFIGURED", "Configure the AI provider before starting an evaluation");
  const answerSheetId = cuid.parse(req.params.answerSheetId);
  const { sheet, exam } = await answerSheetForManager(req, answerSheetId);
  const activeRubric = exam.aiExaminerRubrics.find(rubric => rubric.status === AIExaminerRubricStatus.ACTIVE) ?? null;
  assertAIExaminerEvaluationReady({
    examinationStatus: exam.status,
    questionPaperPublished: Boolean(exam.questionPaper?.publishedAt),
    rubricStatus: activeRubric?.status ?? null,
    finalizedAt: sheet.finalizedAt,
  });
  if (!activeRubric) throw new AppError(409, "AI_EXAMINER_ACTIVE_RUBRIC_REQUIRED", "Activate a marking rubric before AI evaluation");
  if (sheet.status !== AnswerSheetStatus.SUBMITTED && sheet.status !== AnswerSheetStatus.LATE_SUBMITTED) {
    throw new AppError(409, "AI_EXAMINER_ANSWER_ALREADY_IN_REVIEW", "Only a submitted answer sheet can start a new AI evaluation");
  }

  const active = await prisma.aIExaminerEvaluation.findFirst({
    where: {
      organizationId: req.auth!.organizationId,
      answerSheetId,
      status: { in: [AIExaminerEvaluationStatus.QUEUED, AIExaminerEvaluationStatus.PROCESSING, AIExaminerEvaluationStatus.REVIEW_REQUIRED] },
    },
    select: { id: true, status: true, revision: true },
    orderBy: { revision: "desc" },
  });
  if (active) throw new AppError(409, "AI_EXAMINER_EVALUATION_ACTIVE", "This answer sheet already has an AI evaluation awaiting completion or review");

  const latest = await prisma.aIExaminerEvaluation.findFirst({
    where: { organizationId: req.auth!.organizationId, answerSheetId },
    select: { revision: true },
    orderBy: { revision: "desc" },
  });
  const revision = (latest?.revision ?? 0) + 1;
  const queued = await prisma.$transaction(async tx => {
    const locked = await tx.examinationAnswerSheet.updateMany({
      where: {
        id: answerSheetId,
        organizationId: req.auth!.organizationId,
        finalizedAt: null,
        status: { in: [AnswerSheetStatus.SUBMITTED, AnswerSheetStatus.LATE_SUBMITTED] },
      },
      data: { status: AnswerSheetStatus.UNDER_REVIEW },
    });
    if (locked.count !== 1) throw new AppError(409, "AI_EXAMINER_ANSWER_ALREADY_IN_REVIEW", "Answer sheet review has already started");
    const evaluation = await tx.aIExaminerEvaluation.create({
      data: {
        organizationId: req.auth!.organizationId,
        answerSheetId,
        rubricId: activeRubric.id,
        revision,
        status: AIExaminerEvaluationStatus.QUEUED,
        engineVersion: AI_EXAMINER_ENGINE_VERSION,
        provider: env.AI_EXAMINER_PROVIDER_URL ? new URL(env.AI_EXAMINER_PROVIDER_URL).hostname : null,
        model: env.AI_EXAMINER_MODEL,
        requestedById: req.auth!.userId,
      },
      select: { id: true, revision: true, status: true, engineVersion: true, provider: true, model: true, createdAt: true },
    });
    await tx.auditLog.create({
      data: {
        organizationId: req.auth!.organizationId,
        actorId: req.auth!.userId,
        action: "AI_EXAMINER_EVALUATION_QUEUED",
        entity: "AIExaminerEvaluation",
        entityId: evaluation.id,
        metadata: { answerSheetId, examinationId: exam.id, rubricId: activeRubric.id, revision },
      },
    });
    return evaluation;
  });
  res.status(202).json({ data: queued });
});

router.get("/evaluations/:evaluationId", async (req: AuthRequest, res) => {
  const evaluationId = cuid.parse(req.params.evaluationId);
  const row = await prisma.aIExaminerEvaluation.findFirst({
    where: { id: evaluationId, organizationId: req.auth!.organizationId },
    include: {
      questions: { orderBy: { createdAt: "asc" } },
      rubric: { select: { id: true, version: true, status: true, instructions: true, rubric: true, modelAnswer: true } },
      answerSheet: {
        select: {
          id: true, examinationId: true, fileName: true, mimeType: true, status: true, isLate: true, marksObtained: true, finalizedAt: true,
          student: { select: { id: true, admissionNo: true, rollNo: true, user: { select: { name: true } } } },
        },
      },
    },
  });
  if (!row) throw new AppError(404, "AI_EXAMINER_EVALUATION_NOT_FOUND", "AI evaluation not found");
  await examinationForManager(req, row.answerSheet.examinationId);
  res.json({ data: row });
});

router.post("/evaluations/:evaluationId/approve", async (req: AuthRequest, res) => {
  const evaluationId = cuid.parse(req.params.evaluationId);
  const body = z.object({
    questions: z.array(z.object({
      questionKey: z.string().trim().min(1).max(40),
      finalMarks: z.coerce.number().min(-10000).max(10000),
      teacherComment: z.string().trim().max(5000).nullable().optional(),
    })).min(1).max(200),
    teacherRemarks: z.string().trim().max(5000).nullable().optional(),
  }).parse(req.body);

  const evaluation = await prisma.aIExaminerEvaluation.findFirst({
    where: { id: evaluationId, organizationId: req.auth!.organizationId },
    include: {
      questions: true,
      answerSheet: { select: { id: true, examinationId: true, studentId: true, finalizedAt: true, status: true } },
    },
  });
  if (!evaluation) throw new AppError(404, "AI_EXAMINER_EVALUATION_NOT_FOUND", "AI evaluation not found");
  assertAIExaminerReviewable(evaluation.status);
  if (evaluation.status !== AIExaminerEvaluationStatus.REVIEW_REQUIRED) {
    throw new AppError(409, "AI_EXAMINER_ALREADY_APPROVED", "This AI evaluation has already been approved");
  }
  const exam = await examinationForManager(req, evaluation.answerSheet.examinationId);
  if (exam.status !== ExaminationStatus.COMPLETED) throw new AppError(409, "AI_EXAMINER_EVALUATION_CLOSED", "Examination is no longer open for evaluation");
  if (evaluation.answerSheet.finalizedAt) throw new AppError(409, "AI_EXAMINER_ANSWER_FINALIZED", "Answer sheet has already been finalized");

  const byKey = new Map(body.questions.map(row => [row.questionKey.toLowerCase(), row]));
  if (byKey.size !== evaluation.questions.length || body.questions.length !== evaluation.questions.length) {
    throw new AppError(422, "AI_EXAMINER_REVIEW_INCOMPLETE", "Teacher must explicitly review every AI-evaluated question before approval");
  }

  let total = 0;
  for (const question of evaluation.questions) {
    const reviewed = byKey.get(question.questionKey.toLowerCase());
    if (!reviewed) throw new AppError(422, "AI_EXAMINER_REVIEW_INCOMPLETE", `Missing teacher review for ${question.questionKey}`);
    const maximum = Number(question.maxMarks);
    if (reviewed.finalMarks > maximum + 0.001) throw new AppError(422, "AI_EXAMINER_MARKS_EXCEED_MAXIMUM", `Marks for ${question.questionKey} cannot exceed ${maximum}`);
    if (reviewed.finalMarks < -maximum - 0.001) throw new AppError(422, "AI_EXAMINER_MARKS_BELOW_MINIMUM", `Marks for ${question.questionKey} cannot be below -${maximum}`);
    total += reviewed.finalMarks;
  }
  if (total > exam.maximumMarks + 0.001) throw new AppError(422, "AI_EXAMINER_TOTAL_EXCEEDS_MAXIMUM", "Reviewed marks exceed examination maximum marks");

  const now = new Date();
  const teacherRemarks = body.teacherRemarks ?? evaluation.feedback ?? null;
  const approved = await prisma.$transaction(async tx => {
    const locked = await tx.aIExaminerEvaluation.updateMany({
      where: { id: evaluation.id, organizationId: req.auth!.organizationId, status: AIExaminerEvaluationStatus.REVIEW_REQUIRED },
      data: { status: AIExaminerEvaluationStatus.APPROVED, reviewedById: req.auth!.userId, reviewedAt: now },
    });
    if (locked.count !== 1) throw new AppError(409, "AI_EXAMINER_REVIEW_CHANGED", "AI evaluation review state changed; refresh before approving");

    for (const question of evaluation.questions) {
      const reviewed = byKey.get(question.questionKey.toLowerCase())!;
      await tx.aIExaminerQuestionEvaluation.update({
        where: { id: question.id },
        data: { finalMarks: reviewed.finalMarks, teacherComment: reviewed.teacherComment ?? null, reviewRequired: false },
      });
    }

    const answer = await tx.examinationAnswerSheet.updateMany({
      where: {
        id: evaluation.answerSheet.id,
        organizationId: req.auth!.organizationId,
        examinationId: exam.id,
        studentId: evaluation.answerSheet.studentId,
        finalizedAt: null,
        status: AnswerSheetStatus.UNDER_REVIEW,
      },
      data: {
        marksObtained: total,
        teacherRemarks,
        internalNotes: `Ranpal AI Examiner evaluation ${evaluation.id}; engine ${evaluation.engineVersion}; teacher-approved.`,
        evaluatedById: req.auth!.userId,
        evaluatedAt: now,
        status: evaluationStatus(true),
        finalizedAt: now,
      },
    });
    if (answer.count !== 1) throw new AppError(409, "AI_EXAMINER_ANSWER_FINALIZED", "Answer sheet review state changed before approval");

    const result = examinationResultFor(total, exam.maximumMarks, exam.passingMarks, now);
    await tx.examinationResult.upsert({
      where: { examinationId_studentId: { examinationId: exam.id, studentId: evaluation.answerSheet.studentId } },
      update: { ...result, remarks: teacherRemarks },
      create: { organizationId: req.auth!.organizationId, examinationId: exam.id, studentId: evaluation.answerSheet.studentId, ...result, remarks: teacherRemarks },
    });
    await tx.auditLog.create({
      data: {
        organizationId: req.auth!.organizationId,
        actorId: req.auth!.userId,
        action: "AI_EXAMINER_EVALUATION_APPROVED",
        entity: "AIExaminerEvaluation",
        entityId: evaluation.id,
        metadata: {
          answerSheetId: evaluation.answerSheet.id,
          examinationId: exam.id,
          aiSuggestedMarks: evaluation.suggestedMarks == null ? null : Number(evaluation.suggestedMarks),
          teacherApprovedMarks: total,
          finalized: true,
        },
      },
    });
    return tx.aIExaminerEvaluation.findUniqueOrThrow({
      where: { id: evaluation.id },
      include: { questions: { orderBy: { createdAt: "asc" } } },
    });
  });
  res.json({ data: approved, meta: { finalMarks: total, finalized: true } });
});

router.post("/evaluations/:evaluationId/cancel", async (req: AuthRequest, res) => {
  const evaluationId = cuid.parse(req.params.evaluationId);
  const evaluation = await prisma.aIExaminerEvaluation.findFirst({
    where: { id: evaluationId, organizationId: req.auth!.organizationId },
    include: { answerSheet: { select: { id: true, examinationId: true, isLate: true, finalizedAt: true } } },
  });
  if (!evaluation) throw new AppError(404, "AI_EXAMINER_EVALUATION_NOT_FOUND", "AI evaluation not found");
  await examinationForManager(req, evaluation.answerSheet.examinationId);
  if (evaluation.status !== AIExaminerEvaluationStatus.QUEUED && evaluation.status !== AIExaminerEvaluationStatus.REVIEW_REQUIRED && evaluation.status !== AIExaminerEvaluationStatus.FAILED) {
    throw new AppError(409, "AI_EXAMINER_CANCEL_UNAVAILABLE", "This AI evaluation cannot be cancelled in its current state");
  }
  const cancelled = await prisma.$transaction(async tx => {
    const value = await tx.aIExaminerEvaluation.update({
      where: { id: evaluation.id },
      data: { status: AIExaminerEvaluationStatus.CANCELLED, reviewedById: req.auth!.userId, reviewedAt: new Date() },
      select: { id: true, status: true, reviewedAt: true },
    });
    if (!evaluation.answerSheet.finalizedAt) {
      await tx.examinationAnswerSheet.updateMany({
        where: { id: evaluation.answerSheet.id, organizationId: req.auth!.organizationId, status: AnswerSheetStatus.UNDER_REVIEW, finalizedAt: null },
        data: { status: evaluation.answerSheet.isLate ? AnswerSheetStatus.LATE_SUBMITTED : AnswerSheetStatus.SUBMITTED },
      });
    }
    await tx.auditLog.create({ data: { organizationId: req.auth!.organizationId, actorId: req.auth!.userId, action: "AI_EXAMINER_EVALUATION_CANCELLED", entity: "AIExaminerEvaluation", entityId: evaluation.id } });
    return value;
  });
  res.json({ data: cancelled });
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
