import { AcademicBoard, AIExaminerBenchmarkRunStatus, AIExaminerBenchmarkSuiteStatus, AIExaminerEvaluationStatus, AIExaminerExamProfileStatus, AIExaminerReviewMode, AIExaminerReviewRoundKind, AIExaminerReviewRoundStatus, AIExaminerRubricStatus, AIExaminerScanBatchPageStatus, AIExaminerScanBatchStatus, AIExaminerScanBindingStatus, AIExaminerScanPageStatus, AIExaminerRegradeRequestStatus, AIExaminerRegradeScope, AnswerSheetStatus, ClassLevel, ExaminationStatus, Prisma, QuestionType, Role } from "@prisma/client";
import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config.js";
import { AI_EXAMINER_ENGINE_VERSION, AI_EXAMINER_REVIEW_THRESHOLD, aiExaminerProviderConfigured, aiExaminerProviderMode } from "../lib/ai-examiner-engine.js";
import { parseAIExaminerExamProfile } from "../lib/ai-examiner-exam-profile.js";
import {
  assessAIExaminerBenchmarkDrift,
  calculateAIExaminerBenchmarkMetrics,
  evaluateAIExaminerBenchmarkGate,
  groupAIExaminerBenchmarkMetrics,
  type AIExaminerBenchmarkCase,
} from "../lib/ai-examiner-benchmark.js";
import { AI_EXAMINER_ENGINES, AI_EXAMINER_QUESTION_TYPES } from "../lib/ai-examiner-assessment-router.js";
import { aiExaminerRubricInputSchema, aiExaminerRubricStorage } from "../lib/ai-examiner-question-config.js";
import { resolveAIExaminerRubricQuestions } from "../lib/ai-examiner-orchestration.js";
import {
  assertAIExaminerScanToken,
  createAIExaminerScanToken,
  hashAIExaminerScanToken,
  validateAIExaminerOmrIngestion,
} from "../lib/ai-examiner-scan-ingestion.js";
import { aiExaminerLifecycleBlocker, assertAIExaminerEvaluationReady, assertAIExaminerReviewable, assertAIExaminerRubricActivatable } from "../lib/ai-examiner-policy.js";
import { assessAIExaminerReviewCompletion, reviewPolicyFromExamSnapshot } from "../lib/ai-examiner-review-policy.js";
import {
  aiExaminerRegradeWindow,
  normalizeAIExaminerRegradeQuestionKeys,
  regradePolicyFromExamSnapshot,
  resultRevisionSnapshot,
} from "../lib/ai-examiner-regrade.js";
import { assertExaminationManager, evaluationStatus, examinationResultFor } from "../lib/examination-policy.js";
import { analyzeAIExaminerOriginality } from "../lib/ai-examiner-originality.js";
import { aiExaminerEvidenceMimeTypes, assertAIExaminerEvidenceKindMatchesMime, decodeAIExaminerEvidenceUpload, normalizeAIExaminerEvidenceUrl } from "../lib/ai-examiner-evidence-upload.js";
import { renderAIExaminerCheckedCopy } from "../lib/ai-examiner-checked-copy.js";
import { AppError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { storedDocumentBuffer, storedDocumentHeaders } from "../lib/secure-download.js";
import { allowedAnswerSheetTypes, assertDocumentFileExtension, decodeVerifiedUpload } from "../lib/secure-upload.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";
import { requireCommercialFeature } from "../middleware/commercial-entitlement.js";
import checkedCopyReviewRouter from "./ai-examiner-checked-copy.js";

const router = Router();
router.use(requireAuth, allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN, Role.TEACHER), requireCommercialFeature("examinations"));
router.use(checkedCopyReviewRouter);

const cuid = z.string().cuid();
const rubricInput = aiExaminerRubricInputSchema;

const benchmarkThresholdSchema = z.object({
  minimumCases: z.coerce.number().int().min(1).max(100000),
  agreementToleranceMarks: z.coerce.number().min(0).max(10000).default(0),
  agreementToleranceRatio: z.coerce.number().min(0).max(1).default(0),
  maximumNormalizedMae: z.coerce.number().min(0).max(1),
  minimumWithinToleranceRate: z.coerce.number().min(0).max(1),
  maximumOverrideRate: z.coerce.number().min(0).max(1),
  maximumLowConfidenceRate: z.coerce.number().min(0).max(1),
  lowConfidenceThreshold: z.coerce.number().min(0).max(1),
  minimumEvidenceVerificationRate: z.coerce.number().min(0).max(1).optional(),
  drift: z.object({
    maximumNormalizedMaeIncrease: z.coerce.number().min(0).max(1),
    maximumOverrideRateIncrease: z.coerce.number().min(0).max(1),
    maximumLowConfidenceRateIncrease: z.coerce.number().min(0).max(1),
    maximumWithinToleranceRateDrop: z.coerce.number().min(0).max(1),
    maximumEvidenceVerificationRateDrop: z.coerce.number().min(0).max(1).optional(),
  }).optional(),
});

const benchmarkMetricsSchema = z.object({
  caseCount: z.number().int().nonnegative(),
  meanAbsoluteErrorMarks: z.number(),
  normalizedMae: z.number(),
  meanSignedErrorMarks: z.number(),
  withinToleranceRate: z.number(),
  exactAgreementRate: z.number(),
  overrideRate: z.number(),
  lowConfidenceRate: z.number(),
  reviewRequiredRate: z.number(),
  evidenceCaseCount: z.number().int().nonnegative().default(0),
  evidenceVerificationRate: z.number().min(0).max(1).default(0),
});

function requireBenchmarkAdmin(req: AuthRequest) {
  if (req.auth!.role === Role.TEACHER) {
    throw new AppError(403, "AI_EXAMINER_BENCHMARK_ADMIN_REQUIRED", "Only organization or branch administrators can manage benchmark datasets");
  }
}

function requireExamProfileAdmin(req: AuthRequest) {
  if (req.auth!.role === Role.TEACHER) {
    throw new AppError(403, "AI_EXAMINER_PROFILE_ADMIN_REQUIRED", "Only organization or branch administrators can manage exam profiles");
  }
}

function requireRegradeAdmin(req: AuthRequest) {
  if (req.auth!.role === Role.TEACHER) {
    throw new AppError(403, "AI_EXAMINER_REGRADE_ADMIN_REQUIRED", "Only organization or branch administrators can approve, reject or resolve regrade requests");
  }
}

function anonymousReviewFileName(mimeType: string) {
  if (mimeType === "application/pdf") return "anonymous-answer-sheet.pdf";
  if (mimeType === "image/jpeg") return "anonymous-answer-sheet.jpg";
  if (mimeType === "image/png") return "anonymous-answer-sheet.png";
  return "anonymous-answer-sheet";
}

function profileJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function visibleProfileBranchIds(req: AuthRequest): Promise<string[] | null> {
  if (req.auth!.role === Role.SUPER_ADMIN) return null;
  if (req.auth!.role === Role.BRANCH_ADMIN) {
    return (await prisma.branchUser.findMany({
      where: { organizationId: req.auth!.organizationId, userId: req.auth!.userId },
      select: { branchId: true },
    })).map(row => row.branchId);
  }
  const teacher = await prisma.teacherProfile.findFirst({
    where: { organizationId: req.auth!.organizationId, userId: req.auth!.userId },
    select: { branchId: true },
  });
  return teacher ? [teacher.branchId] : [];
}

async function benchmarkSuiteForRequest(req: AuthRequest, suiteId: string) {
  const suite = await prisma.aIExaminerBenchmarkSuite.findFirst({
    where: { id: suiteId, organizationId: req.auth!.organizationId },
    include: {
      subject: { select: { id: true, name: true, code: true } },
      branch: { select: { id: true, branchName: true } },
      _count: { select: { cases: true, runs: true } },
    },
  });
  if (!suite) throw new AppError(404, "AI_EXAMINER_BENCHMARK_SUITE_NOT_FOUND", "Benchmark suite not found");
  if (suite.branchId) {
    const visibleBranches = await visibleProfileBranchIds(req);
    if (visibleBranches && !visibleBranches.includes(suite.branchId)) {
      throw new AppError(403, "BRANCH_FORBIDDEN", "Branch access denied");
    }
  }
  return suite;
}

async function branchAccess(req: AuthRequest, branchId: string) {
  if (req.auth!.role !== Role.BRANCH_ADMIN) return;
  const found = await prisma.branchUser.findFirst({
    where: { organizationId: req.auth!.organizationId, userId: req.auth!.userId, branchId },
    select: { branchId: true },
  });
  if (!found) throw new AppError(403, "BRANCH_FORBIDDEN", "Branch access denied");
}

async function assertEligibleReviewRoundReviewer(req: AuthRequest, reviewerId: string, branchId: string) {
  const reviewer = await prisma.user.findFirst({
    where: {
      id: reviewerId,
      organizationId: req.auth!.organizationId,
      isActive: true,
      role: { in: [Role.SUPER_ADMIN, Role.BRANCH_ADMIN, Role.TEACHER] },
    },
    select: {
      id: true,
      role: true,
      teacherProfile: { select: { branchId: true } },
      branchAssignments: { where: { branchId }, select: { branchId: true } },
    },
  });
  if (!reviewer) throw new AppError(422, "AI_EXAMINER_REVIEWER_INVALID", "Reviewer must be an active teacher or administrator in this organization");
  if (reviewer.role === Role.TEACHER && reviewer.teacherProfile?.branchId !== branchId) {
    throw new AppError(422, "AI_EXAMINER_REVIEWER_BRANCH_INVALID", "Teacher reviewer must belong to the examination branch");
  }
  if (reviewer.role === Role.BRANCH_ADMIN && !reviewer.branchAssignments.length) {
    throw new AppError(422, "AI_EXAMINER_REVIEWER_BRANCH_INVALID", "Branch administrator reviewer must be assigned to the examination branch");
  }
  return reviewer;
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
      aiExaminerExamProfile: { select: { id: true, code: true, name: true, kind: true, version: true, status: true, branchId: true } },
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

async function publicationAuditTime(organizationId: string, examinationId: string) {
  const published = await prisma.auditLog.findFirst({
    where: {
      organizationId,
      entity: "Examination",
      entityId: examinationId,
      action: "PUBLISH",
    },
    select: { createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return published?.createdAt ?? null;
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

async function recomputePublishedRanks(tx: Prisma.TransactionClient, organizationId: string, examinationId: string) {
  const rows = await tx.examinationResult.findMany({
    where: { organizationId, examinationId },
    select: { id: true, marksObtained: true, rank: true },
  });
  const ranked = rows
    .filter((row): row is typeof row & { marksObtained: NonNullable<typeof row.marksObtained> } => row.marksObtained != null)
    .sort((a, b) => Number(b.marksObtained) - Number(a.marksObtained) || a.id.localeCompare(b.id));
  const impacts: Array<{ resultId: string; beforeRank: number | null; afterRank: number | null }> = [];
  let rank = 0;
  let lastMarks: number | null = null;
  let position = 0;
  for (const row of ranked) {
    position += 1;
    const marks = Number(row.marksObtained);
    if (lastMarks === null || marks < lastMarks) rank = position;
    lastMarks = marks;
    if (row.rank !== rank) {
      impacts.push({ resultId: row.id, beforeRank: row.rank, afterRank: rank });
      await tx.examinationResult.update({ where: { id: row.id }, data: { rank } });
    }
  }
  for (const row of rows.filter(row => row.marksObtained == null && row.rank != null)) {
    impacts.push({ resultId: row.id, beforeRank: row.rank, afterRank: null });
    await tx.examinationResult.update({ where: { id: row.id }, data: { rank: null } });
  }
  return impacts;
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
      examProfile: exam.aiExaminerExamProfile,
      examProfileSnapshotPresent: Boolean(exam.aiExaminerExamProfileSnapshot),
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

router.get("/examinations/:examinationId/originality", async (req: AuthRequest, res) => {
  const examinationId = cuid.parse(req.params.examinationId);
  await examinationForManager(req, examinationId);
  const query = z.object({
    shingleSize: z.coerce.number().int().min(2).max(12).default(5),
    minimumTokens: z.coerce.number().int().min(5).max(5000).default(20),
    signalThreshold: z.coerce.number().min(0.5).max(1).default(0.8),
    maximumSignals: z.coerce.number().int().min(1).max(1000).default(200),
  }).parse(req.query);

  const evaluations = await prisma.aIExaminerEvaluation.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      status: AIExaminerEvaluationStatus.APPROVED,
      answerSheet: { examinationId },
    },
    select: {
      id: true,
      revision: true,
      answerSheetId: true,
      reviewedAt: true,
      answerSheet: { select: { studentId: true } },
      questions: { select: { questionKey: true, extractedAnswer: true } },
    },
    orderBy: [{ reviewedAt: "desc" }, { revision: "desc" }],
    take: 5000,
  });

  const latestBySheet = new Map<string, typeof evaluations[number]>();
  for (const evaluation of evaluations) {
    if (!latestBySheet.has(evaluation.answerSheetId)) latestBySheet.set(evaluation.answerSheetId, evaluation);
  }
  if (latestBySheet.size > 500) {
    throw new AppError(422, "AI_EXAMINER_ORIGINALITY_DATASET_TOO_LARGE", "Originality analysis supports up to 500 answer sheets per run");
  }

  const answers = [...latestBySheet.values()].flatMap(evaluation =>
    evaluation.questions.map(question => ({
      answerSheetId: evaluation.answerSheetId,
      studentId: evaluation.answerSheet.studentId,
      questionKey: question.questionKey,
      text: question.extractedAnswer,
    }))
  );
  const report = analyzeAIExaminerOriginality(answers, query);
  await prisma.auditLog.create({
    data: {
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      action: "AI_EXAMINER_ORIGINALITY_ANALYZED",
      entity: "Examination",
      entityId: examinationId,
      metadata: {
        answerSheets: latestBySheet.size,
        comparedAnswers: report.comparedAnswers,
        comparedPairs: report.comparedPairs,
        signalCount: report.signals.length,
        methodology: report.methodology,
      },
    },
  });
  res.json({ data: report });
});

router.get("/capabilities", async (_req, res) => {
  res.json({ data: { providerConfigured: aiExaminerProviderConfigured(), providerMode: aiExaminerProviderMode(), model: env.AI_EXAMINER_MODEL, engineVersion: AI_EXAMINER_ENGINE_VERSION, reviewThreshold: AI_EXAMINER_REVIEW_THRESHOLD, evaluationExecutionAvailable: aiExaminerProviderConfigured(), questionTypes: AI_EXAMINER_QUESTION_TYPES, engines: AI_EXAMINER_ENGINES, phase: "EVALUATION_ENGINE" } });
});

router.get("/benchmark-suites", async (req: AuthRequest, res) => {
  const branches = await visibleProfileBranchIds(req);
  const status = z.nativeEnum(AIExaminerBenchmarkSuiteStatus).optional().parse(req.query.status);
  const data = await prisma.aIExaminerBenchmarkSuite.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      ...(status ? { status } : {}),
      ...(branches ? { OR: [{ branchId: null }, { branchId: { in: branches } }] } : {}),
    },
    select: {
      id: true, branchId: true, subjectId: true, code: true, name: true, classLevel: true,
      academicBoard: true, questionType: true, status: true, thresholds: true, approvedAt: true,
      createdAt: true, updatedAt: true, _count: { select: { cases: true, runs: true } },
      subject: { select: { id: true, name: true, code: true } },
      branch: { select: { id: true, branchName: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  res.json({ data });
});

router.post("/benchmark-suites", async (req: AuthRequest, res) => {
  requireBenchmarkAdmin(req);
  const body = z.object({
    branchId: cuid.nullable().optional(),
    subjectId: cuid.nullable().optional(),
    code: z.string().trim().min(2).max(80).regex(/^[A-Z0-9][A-Z0-9_-]*$/),
    name: z.string().trim().min(2).max(180),
    classLevel: z.nativeEnum(ClassLevel).nullable().optional(),
    academicBoard: z.nativeEnum(AcademicBoard).nullable().optional(),
    questionType: z.nativeEnum(QuestionType).nullable().optional(),
    thresholds: benchmarkThresholdSchema,
  }).parse(req.body);
  const branchId = body.branchId ?? null;
  if (req.auth!.role === Role.BRANCH_ADMIN && !branchId) {
    throw new AppError(422, "AI_EXAMINER_BENCHMARK_BRANCH_REQUIRED", "Branch administrators can create branch-scoped benchmark suites only");
  }
  if (branchId) {
    await branchAccess(req, branchId);
    if (!await prisma.branch.findFirst({ where: { id: branchId, organizationId: req.auth!.organizationId }, select: { id: true } })) {
      throw new AppError(422, "INVALID_BRANCH", "Benchmark suite branch is invalid");
    }
  }
  if (body.subjectId && !await prisma.subject.findFirst({ where: { id: body.subjectId, organizationId: req.auth!.organizationId }, select: { id: true } })) {
    throw new AppError(422, "INVALID_SUBJECT", "Benchmark suite subject is invalid");
  }
  if (await prisma.aIExaminerBenchmarkSuite.findFirst({ where: { organizationId: req.auth!.organizationId, code: body.code }, select: { id: true } })) {
    throw new AppError(409, "AI_EXAMINER_BENCHMARK_SUITE_EXISTS", "Benchmark suite code already exists");
  }
  const data = await prisma.aIExaminerBenchmarkSuite.create({
    data: {
      organizationId: req.auth!.organizationId,
      branchId,
      subjectId: body.subjectId ?? null,
      code: body.code,
      name: body.name,
      classLevel: body.classLevel ?? null,
      academicBoard: body.academicBoard ?? null,
      questionType: body.questionType ?? null,
      thresholds: profileJson(body.thresholds),
      createdById: req.auth!.userId,
    },
  });
  await prisma.auditLog.create({ data: {
    organizationId: req.auth!.organizationId,
    actorId: req.auth!.userId,
    action: "AI_EXAMINER_BENCHMARK_SUITE_CREATED",
    entity: "AIExaminerBenchmarkSuite",
    entityId: data.id,
    metadata: { code: data.code, branchId: data.branchId, subjectId: data.subjectId, questionType: data.questionType },
  } }).catch(() => null);
  res.status(201).json({ data });
});

router.post("/benchmark-suites/:suiteId/cases", async (req: AuthRequest, res) => {
  requireBenchmarkAdmin(req);
  const suite = await benchmarkSuiteForRequest(req, cuid.parse(req.params.suiteId));
  if (suite.status !== AIExaminerBenchmarkSuiteStatus.DRAFT) {
    throw new AppError(409, "AI_EXAMINER_BENCHMARK_SUITE_IMMUTABLE", "Benchmark cases can only be changed while the suite is draft");
  }
  if (req.auth!.role === Role.BRANCH_ADMIN && !suite.branchId) {
    throw new AppError(403, "BRANCH_FORBIDDEN", "Organization-wide benchmark suites can only be changed by a super administrator");
  }
  const body = z.object({
    sourceAnswerSheetId: cuid,
    questionKey: z.string().trim().min(1).max(40),
    maxMarks: z.coerce.number().positive().max(10000),
    minimumMarks: z.coerce.number().min(-10000).max(10000).default(0),
    humanMarks: z.coerce.number().min(-10000).max(10000),
    goldNotes: z.string().trim().max(10000).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).superRefine((value, ctx) => {
    if (value.minimumMarks > value.maxMarks) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["minimumMarks"], message: "Minimum marks cannot exceed maximum marks" });
    if (value.humanMarks < value.minimumMarks || value.humanMarks > value.maxMarks) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["humanMarks"], message: "Human marks must be within configured question bounds" });
  }).parse(req.body);

  const reviewer = await prisma.user.findFirst({
    where: { id: req.auth!.userId, organizationId: req.auth!.organizationId, isActive: true },
    select: { id: true, role: true },
  });
  if (
    !reviewer ||
    (
      reviewer.role !== Role.SUPER_ADMIN &&
      reviewer.role !== Role.BRANCH_ADMIN &&
      reviewer.role !== Role.TEACHER
    )
  ) {
    throw new AppError(422, "AI_EXAMINER_BENCHMARK_REVIEWER_INVALID", "Human benchmark reviewer must be an active teacher or administrator");
  }

  const { sheet, exam } = await answerSheetForManager(req, body.sourceAnswerSheetId);
  if (!sheet.finalizedAt || sheet.marksObtained == null) {
    throw new AppError(409, "AI_EXAMINER_BENCHMARK_SOURCE_NOT_FINAL", "Benchmark gold cases must come from a finalized, marked answer sheet");
  }
  if (suite.branchId && suite.branchId !== exam.branchId) {
    throw new AppError(422, "AI_EXAMINER_BENCHMARK_BRANCH_MISMATCH", "Source answer sheet must belong to the benchmark suite branch");
  }
  if (suite.subjectId && suite.subjectId !== exam.subjectId) {
    throw new AppError(422, "AI_EXAMINER_BENCHMARK_SUBJECT_MISMATCH", "Source answer sheet subject must match the benchmark suite subject");
  }

  const data = await prisma.aIExaminerBenchmarkCase.create({
    data: {
      organizationId: req.auth!.organizationId,
      suiteId: suite.id,
      sourceAnswerSheetId: sheet.id,
      questionKey: body.questionKey,
      maxMarks: body.maxMarks,
      minimumMarks: body.minimumMarks,
      humanMarks: body.humanMarks,
      humanReviewerId: reviewer.id,
      goldNotes: body.goldNotes ?? null,
      ...(body.metadata ? { metadata: profileJson(body.metadata) } : {}),
    },
  });
  await prisma.auditLog.create({ data: {
    organizationId: req.auth!.organizationId,
    actorId: req.auth!.userId,
    action: "AI_EXAMINER_BENCHMARK_CASE_CREATED",
    entity: "AIExaminerBenchmarkCase",
    entityId: data.id,
    metadata: { suiteId: suite.id, answerSheetId: sheet.id, questionKey: body.questionKey, humanReviewerId: reviewer.id },
  } }).catch(() => null);
  res.status(201).json({ data });
});

router.get("/benchmark-suites/:suiteId/cases", async (req: AuthRequest, res) => {
  requireBenchmarkAdmin(req);
  const suite = await benchmarkSuiteForRequest(req, cuid.parse(req.params.suiteId));
  const data = await prisma.aIExaminerBenchmarkCase.findMany({
    where: { organizationId: req.auth!.organizationId, suiteId: suite.id },
    select: {
      id: true, sourceAnswerSheetId: true, questionKey: true, maxMarks: true, minimumMarks: true,
      humanMarks: true, goldNotes: true, metadata: true, isActive: true, createdAt: true, updatedAt: true,
      humanReviewer: { select: { id: true, name: true } },
      sourceAnswerSheet: {
        select: {
          id: true, fileName: true, finalizedAt: true, marksObtained: true,
          student: { select: { id: true, admissionNo: true, rollNo: true, user: { select: { name: true } } } },
          examination: { select: { id: true, name: true, code: true } },
        },
      },
    },
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    take: 100000,
  });
  res.json({ data });
});

async function benchmarkDatasetCandidates(req: AuthRequest, suite: Awaited<ReturnType<typeof benchmarkSuiteForRequest>>) {
  const [existingCases, sheets] = await Promise.all([
    prisma.aIExaminerBenchmarkCase.findMany({
      where: { organizationId: req.auth!.organizationId, suiteId: suite.id, isActive: true },
      select: {
        sourceAnswerSheetId: true,
        questionKey: true,
        sourceAnswerSheet: { select: { id: true, fileData: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.examinationAnswerSheet.findMany({
      where: {
        organizationId: req.auth!.organizationId,
        finalizedAt: { not: null },
        marksObtained: { not: null },
        examination: {
          ...(suite.branchId ? { branchId: suite.branchId } : {}),
          ...(suite.subjectId ? { subjectId: suite.subjectId } : {}),
        },
      },
      select: {
        id: true,
        fileName: true,
        fileData: true,
        finalizedAt: true,
        marksObtained: true,
        student: { select: { id: true, admissionNo: true, rollNo: true, user: { select: { name: true } } } },
        examination: { select: { id: true, name: true, code: true, branchId: true, subjectId: true } },
        aiEvaluations: {
          where: { status: AIExaminerEvaluationStatus.APPROVED },
          select: {
            id: true,
            revision: true,
            reviewedById: true,
            reviewedAt: true,
            engineVersion: true,
            provider: true,
            model: true,
            confidence: true,
            questions: {
              select: {
                questionKey: true,
                maxMarks: true,
                suggestedMarks: true,
                finalMarks: true,
                confidence: true,
                reviewRequired: true,
              },
            },
          },
          orderBy: { revision: "desc" },
          take: 1,
        },
      },
      orderBy: [{ finalizedAt: "asc" }, { id: "asc" }],
      take: 500,
    }),
  ]);

  const fingerprint = (bytes: Uint8Array) => crypto.createHash("sha256").update(Buffer.from(bytes)).digest("hex");
  const existingPairs = new Set(existingCases.map(item => `${item.sourceAnswerSheetId ?? ""}:${item.questionKey}`));
  const existingSourceIds = new Set(existingCases.map(item => item.sourceAnswerSheetId).filter((value): value is string => Boolean(value)));
  const existingFingerprintSources = new Map<string, Set<string>>();
  for (const item of existingCases) {
    if (!item.sourceAnswerSheetId || !item.sourceAnswerSheet?.fileData) continue;
    const hash = fingerprint(item.sourceAnswerSheet.fileData);
    const ids = existingFingerprintSources.get(hash) ?? new Set<string>();
    ids.add(item.sourceAnswerSheetId);
    existingFingerprintSources.set(hash, ids);
  }

  const sheetFingerprint = new Map(sheets.map(sheet => [sheet.id, fingerprint(sheet.fileData)]));
  const canonicalSourceByFingerprint = new Map<string, string>();
  for (const [hash, sourceIds] of existingFingerprintSources) {
    const first = [...sourceIds].sort()[0];
    if (first) canonicalSourceByFingerprint.set(hash, first);
  }
  for (const sheet of sheets) {
    const hash = sheetFingerprint.get(sheet.id)!;
    if (!canonicalSourceByFingerprint.has(hash)) canonicalSourceByFingerprint.set(hash, sheet.id);
  }

  let noApprovedEvaluationSources = 0;
  let noFinalQuestionMarksSources = 0;
  const candidates: Array<{
    sourceAnswerSheetId: string;
    questionKey: string;
    maxMarks: number;
    humanMarks: number;
    aiSuggestedMarks: number | null;
    confidence: number;
    examination: { id: string; name: string; code: string };
    student: { id: string; admissionNo: string; rollNo: string; name: string };
    fileName: string;
    finalizedAt: Date | null;
    contentFingerprint: string;
    sourceEvaluationId: string;
    sourceEvaluationRevision: number;
    humanReviewerId: string | null;
    engineVersion: string;
    provider: string | null;
    model: string | null;
    alreadyAdded: boolean;
    duplicateSourceContent: boolean;
    eligible: boolean;
  }> = [];

  for (const sheet of sheets) {
    const evaluation = sheet.aiEvaluations[0];
    if (!evaluation) {
      noApprovedEvaluationSources += 1;
      continue;
    }
    const finalQuestions = evaluation.questions.filter(question => question.finalMarks != null);
    if (!finalQuestions.length) {
      noFinalQuestionMarksSources += 1;
      continue;
    }
    const hash = sheetFingerprint.get(sheet.id)!;
    const canonicalSourceId = canonicalSourceByFingerprint.get(hash)!;
    const duplicateSourceContent = canonicalSourceId !== sheet.id && !existingSourceIds.has(sheet.id);
    for (const question of finalQuestions) {
      const pairKey = `${sheet.id}:${question.questionKey}`;
      const alreadyAdded = existingPairs.has(pairKey);
      candidates.push({
        sourceAnswerSheetId: sheet.id,
        questionKey: question.questionKey,
        maxMarks: Number(question.maxMarks),
        humanMarks: Number(question.finalMarks),
        aiSuggestedMarks: question.suggestedMarks == null ? null : Number(question.suggestedMarks),
        confidence: Number(question.confidence ?? evaluation.confidence ?? 0),
        examination: sheet.examination,
        student: {
          id: sheet.student.id,
          admissionNo: sheet.student.admissionNo,
          rollNo: sheet.student.rollNo,
          name: sheet.student.user.name,
        },
        fileName: sheet.fileName,
        finalizedAt: sheet.finalizedAt,
        contentFingerprint: hash.slice(0, 16),
        sourceEvaluationId: evaluation.id,
        sourceEvaluationRevision: evaluation.revision,
        humanReviewerId: evaluation.reviewedById,
        engineVersion: evaluation.engineVersion,
        provider: evaluation.provider,
        model: evaluation.model,
        alreadyAdded,
        duplicateSourceContent,
        eligible: !alreadyAdded && !duplicateSourceContent,
      });
    }
  }

  const sourceHashes = new Set(sheets.map(sheet => sheetFingerprint.get(sheet.id)!));
  const duplicateSourceCount = sheets.length - sourceHashes.size;
  return {
    suiteId: suite.id,
    minimumCases: benchmarkThresholdSchema.parse(suite.thresholds).minimumCases,
    existingCaseCount: existingCases.length,
    finalizedSourceCount: sheets.length,
    independentSourceCount: sourceHashes.size,
    duplicateSourceCount,
    noApprovedEvaluationSources,
    noFinalQuestionMarksSources,
    eligibleCaseCount: candidates.filter(candidate => candidate.eligible).length,
    candidates,
  };
}

router.get("/benchmark-suites/:suiteId/candidate-pool", async (req: AuthRequest, res) => {
  requireBenchmarkAdmin(req);
  const suite = await benchmarkSuiteForRequest(req, cuid.parse(req.params.suiteId));
  res.json({ data: await benchmarkDatasetCandidates(req, suite) });
});

router.post("/benchmark-suites/:suiteId/cases/bulk-import", async (req: AuthRequest, res) => {
  requireBenchmarkAdmin(req);
  const suite = await benchmarkSuiteForRequest(req, cuid.parse(req.params.suiteId));
  if (suite.status !== AIExaminerBenchmarkSuiteStatus.DRAFT) {
    throw new AppError(409, "AI_EXAMINER_BENCHMARK_SUITE_IMMUTABLE", "Benchmark cases can only be imported while the suite is draft");
  }
  if (req.auth!.role === Role.BRANCH_ADMIN && !suite.branchId) {
    throw new AppError(403, "BRANCH_FORBIDDEN", "Organization-wide benchmark suites can only be changed by a super administrator");
  }
  const body = z.object({
    candidates: z.array(z.object({
      sourceAnswerSheetId: cuid,
      questionKey: z.string().trim().min(1).max(40),
    })).min(1).max(500),
  }).parse(req.body);
  const requestedKeys = body.candidates.map(item => `${item.sourceAnswerSheetId}:${item.questionKey}`);
  if (new Set(requestedKeys).size !== requestedKeys.length) {
    throw new AppError(422, "AI_EXAMINER_BENCHMARK_IMPORT_DUPLICATE", "Each selected source question may be imported only once per request");
  }

  const pool = await benchmarkDatasetCandidates(req, suite);
  const candidateMap = new Map(pool.candidates.map(candidate => [`${candidate.sourceAnswerSheetId}:${candidate.questionKey}`, candidate]));
  const selected = requestedKeys.map(key => {
    const candidate = candidateMap.get(key);
    if (!candidate) throw new AppError(422, "AI_EXAMINER_BENCHMARK_CANDIDATE_INVALID", "Selected benchmark candidate is not available in the verified candidate pool");
    if (!candidate.eligible) {
      const reason = candidate.alreadyAdded ? "already exists in this suite" : "duplicates source answer content already represented in the dataset";
      throw new AppError(409, "AI_EXAMINER_BENCHMARK_CANDIDATE_INELIGIBLE", `Benchmark candidate ${candidate.questionKey} ${reason}`);
    }
    return candidate;
  });

  const fallbackReviewer = await prisma.user.findFirst({
    where: { id: req.auth!.userId, organizationId: req.auth!.organizationId, isActive: true },
    select: { id: true, role: true },
  });
  if (!fallbackReviewer || (fallbackReviewer.role !== Role.SUPER_ADMIN && fallbackReviewer.role !== Role.BRANCH_ADMIN && fallbackReviewer.role !== Role.TEACHER)) {
    throw new AppError(422, "AI_EXAMINER_BENCHMARK_REVIEWER_INVALID", "Authenticated benchmark importer must be an active teacher or administrator");
  }

  const created = await prisma.$transaction(async tx => {
    const rows = [];
    for (const candidate of selected) {
      const reviewerId = candidate.humanReviewerId ?? fallbackReviewer.id;
      const row = await tx.aIExaminerBenchmarkCase.create({
        data: {
          organizationId: req.auth!.organizationId,
          suiteId: suite.id,
          sourceAnswerSheetId: candidate.sourceAnswerSheetId,
          questionKey: candidate.questionKey,
          maxMarks: candidate.maxMarks,
          minimumMarks: 0,
          humanMarks: candidate.humanMarks,
          humanReviewerId: reviewerId,
          goldNotes: "Imported from teacher-approved final question marks.",
          metadata: profileJson({
            source: "benchmark-dataset-builder",
            sourceEvaluationId: candidate.sourceEvaluationId,
            sourceEvaluationRevision: candidate.sourceEvaluationRevision,
            sourceEngineVersion: candidate.engineVersion,
            sourceProvider: candidate.provider,
            sourceModel: candidate.model,
            contentFingerprint: candidate.contentFingerprint,
          }),
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: req.auth!.organizationId,
          actorId: req.auth!.userId,
          action: "AI_EXAMINER_BENCHMARK_CASE_IMPORTED",
          entity: "AIExaminerBenchmarkCase",
          entityId: row.id,
          metadata: {
            suiteId: suite.id,
            answerSheetId: candidate.sourceAnswerSheetId,
            questionKey: candidate.questionKey,
            humanReviewerId: reviewerId,
            sourceEvaluationId: candidate.sourceEvaluationId,
          },
        },
      });
      rows.push(row);
    }
    return rows;
  });

  res.status(201).json({ data: { imported: created.length, caseIds: created.map(row => row.id) } });
});

router.get("/benchmark-suites/:suiteId/evaluation-results", async (req: AuthRequest, res) => {
  requireBenchmarkAdmin(req);
  const suite = await benchmarkSuiteForRequest(req, cuid.parse(req.params.suiteId));
  const cases = await prisma.aIExaminerBenchmarkCase.findMany({
    where: { organizationId: req.auth!.organizationId, suiteId: suite.id, isActive: true },
    select: { id: true, sourceAnswerSheetId: true, questionKey: true },
    orderBy: { createdAt: "asc" },
  });
  const sourceAnswerSheetIds = [...new Set(cases.map(row => row.sourceAnswerSheetId).filter((value): value is string => Boolean(value)))];
  const evaluations = sourceAnswerSheetIds.length
    ? await prisma.aIExaminerEvaluation.findMany({
        where: {
          organizationId: req.auth!.organizationId,
          answerSheetId: { in: sourceAnswerSheetIds },
          status: AIExaminerEvaluationStatus.APPROVED,
        },
        select: {
          id: true, answerSheetId: true, revision: true, engineVersion: true, provider: true, model: true, confidence: true,
          questions: {
            select: { questionKey: true, suggestedMarks: true, finalMarks: true, confidence: true, reviewRequired: true },
          },
        },
        orderBy: { revision: "desc" },
      })
    : [];
  const latestBySheet = new Map<string, typeof evaluations[number]>();
  for (const evaluation of evaluations) {
    if (!latestBySheet.has(evaluation.answerSheetId)) latestBySheet.set(evaluation.answerSheetId, evaluation);
  }

  const results: Array<{
    caseId: string;
    aiMarks: number;
    confidence: number;
    reviewRequired: boolean;
    teacherOverride: boolean;
    diagnostics: Record<string, unknown>;
  }> = [];
  const missing: Array<{ caseId: string; reason: string }> = [];
  const executionContexts = new Set<string>();

  for (const benchmarkCase of cases) {
    if (!benchmarkCase.sourceAnswerSheetId) {
      missing.push({ caseId: benchmarkCase.id, reason: "Benchmark case has no source answer sheet" });
      continue;
    }
    const evaluation = latestBySheet.get(benchmarkCase.sourceAnswerSheetId);
    if (!evaluation) {
      missing.push({ caseId: benchmarkCase.id, reason: "No approved AI evaluation exists for the source answer sheet" });
      continue;
    }
    const question = evaluation.questions.find(item => item.questionKey === benchmarkCase.questionKey);
    if (!question || question.suggestedMarks == null) {
      missing.push({ caseId: benchmarkCase.id, reason: "Approved AI evaluation has no suggested marks for the benchmark question" });
      continue;
    }
    const suggestedMarks = Number(question.suggestedMarks);
    const finalMarks = question.finalMarks == null ? null : Number(question.finalMarks);
    results.push({
      caseId: benchmarkCase.id,
      aiMarks: suggestedMarks,
      confidence: Number(question.confidence ?? evaluation.confidence ?? 0),
      reviewRequired: question.reviewRequired,
      teacherOverride: finalMarks != null && Math.abs(finalMarks - suggestedMarks) > 0.0001,
      diagnostics: {
        source: "approved-ai-evaluation",
        evaluationId: evaluation.id,
        revision: evaluation.revision,
        finalMarks,
      },
    });
    executionContexts.add(JSON.stringify({
      engineVersion: evaluation.engineVersion,
      provider: evaluation.provider ?? null,
      model: evaluation.model ?? null,
    }));
  }

  const contexts = [...executionContexts].map(value => JSON.parse(value) as { engineVersion: string; provider: string | null; model: string | null });
  const context = contexts.length === 1 ? contexts[0] : null;
  res.json({
    data: {
      suiteId: suite.id,
      caseCount: cases.length,
      readyForRun: cases.length > 0 && missing.length === 0 && Boolean(context),
      engineVersion: context?.engineVersion ?? null,
      provider: context?.provider ?? null,
      model: context?.model ?? null,
      results,
      missing,
      mixedExecutionContexts: contexts.length > 1 ? contexts : [],
    },
  });
});

router.post("/benchmark-suites/:suiteId/activate", async (req: AuthRequest, res) => {
  requireBenchmarkAdmin(req);
  const suite = await benchmarkSuiteForRequest(req, cuid.parse(req.params.suiteId));
  if (suite.status !== AIExaminerBenchmarkSuiteStatus.DRAFT) {
    throw new AppError(409, "AI_EXAMINER_BENCHMARK_SUITE_NOT_DRAFT", "Only a draft benchmark suite can be activated");
  }
  if (req.auth!.role === Role.BRANCH_ADMIN && !suite.branchId) {
    throw new AppError(403, "BRANCH_FORBIDDEN", "Organization-wide benchmark suites can only be activated by a super administrator");
  }
  const thresholds = benchmarkThresholdSchema.parse(suite.thresholds);
  const activeCases = await prisma.aIExaminerBenchmarkCase.count({ where: { organizationId: req.auth!.organizationId, suiteId: suite.id, isActive: true } });
  if (activeCases < thresholds.minimumCases) {
    throw new AppError(409, "AI_EXAMINER_BENCHMARK_CASES_INSUFFICIENT", `Benchmark suite requires at least ${thresholds.minimumCases} active human-marked cases before activation`);
  }
  const now = new Date();
  const data = await prisma.aIExaminerBenchmarkSuite.update({
    where: { id: suite.id },
    data: { status: AIExaminerBenchmarkSuiteStatus.ACTIVE, approvedById: req.auth!.userId, approvedAt: now },
  });
  await prisma.auditLog.create({ data: {
    organizationId: req.auth!.organizationId,
    actorId: req.auth!.userId,
    action: "AI_EXAMINER_BENCHMARK_SUITE_ACTIVATED",
    entity: "AIExaminerBenchmarkSuite",
    entityId: suite.id,
    metadata: { activeCases, minimumCases: thresholds.minimumCases },
  } }).catch(() => null);
  res.json({ data });
});

router.get("/benchmark-suites/:suiteId/runs", async (req: AuthRequest, res) => {
  const suite = await benchmarkSuiteForRequest(req, cuid.parse(req.params.suiteId));
  const data = await prisma.aIExaminerBenchmarkRun.findMany({
    where: { organizationId: req.auth!.organizationId, suiteId: suite.id },
    select: {
      id: true, engineVersion: true, provider: true, model: true, status: true, thresholds: true,
      metrics: true, benchmarkReady: true, startedAt: true, completedAt: true, createdAt: true,
      _count: { select: { results: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json({ data });
});

router.post("/benchmark-suites/:suiteId/runs", async (req: AuthRequest, res) => {
  requireBenchmarkAdmin(req);
  const suite = await benchmarkSuiteForRequest(req, cuid.parse(req.params.suiteId));
  if (suite.status !== AIExaminerBenchmarkSuiteStatus.ACTIVE) {
    throw new AppError(409, "AI_EXAMINER_BENCHMARK_SUITE_INACTIVE", "Activate the benchmark suite before recording a benchmark run");
  }
  if (req.auth!.role === Role.BRANCH_ADMIN && !suite.branchId) {
    throw new AppError(403, "BRANCH_FORBIDDEN", "Organization-wide benchmark runs can only be recorded by a super administrator");
  }
  const body = z.object({
    engineVersion: z.string().trim().min(1).max(120),
    provider: z.string().trim().min(1).max(160).nullable().optional(),
    model: z.string().trim().min(1).max(160).nullable().optional(),
    results: z.array(z.object({
      caseId: cuid,
      aiMarks: z.coerce.number().min(-10000).max(10000),
      confidence: z.coerce.number().min(0).max(1),
      reviewRequired: z.boolean().default(true),
      teacherOverride: z.boolean().default(false),
      diagnostics: z.record(z.string(), z.unknown()).optional(),
      errorCode: z.string().trim().max(160).nullable().optional(),
    })).min(1).max(100000),
  }).parse(req.body);

  const cases = await prisma.aIExaminerBenchmarkCase.findMany({
    where: { organizationId: req.auth!.organizationId, suiteId: suite.id, isActive: true },
    select: { id: true, maxMarks: true, minimumMarks: true, humanMarks: true },
    orderBy: { createdAt: "asc" },
  });
  const caseMap = new Map(cases.map(row => [row.id, row]));
  const resultMap = new Map<string, typeof body.results[number]>();
  for (const result of body.results) {
    if (resultMap.has(result.caseId)) throw new AppError(422, "AI_EXAMINER_BENCHMARK_DUPLICATE_RESULT", "Each benchmark case may appear only once in a run");
    if (!caseMap.has(result.caseId)) throw new AppError(422, "AI_EXAMINER_BENCHMARK_CASE_INVALID", "Benchmark run contains a case outside the active suite");
    resultMap.set(result.caseId, result);
  }
  if (resultMap.size !== cases.length) {
    throw new AppError(422, "AI_EXAMINER_BENCHMARK_RUN_INCOMPLETE", `Benchmark run must contain all ${cases.length} active cases`);
  }

  const thresholds = benchmarkThresholdSchema.parse(suite.thresholds);
  const benchmarkRows: AIExaminerBenchmarkCase[] = cases.map(row => {
    const result = resultMap.get(row.id)!;
    return {
      id: row.id,
      humanMarks: Number(row.humanMarks),
      aiMarks: result.aiMarks,
      maxMarks: Number(row.maxMarks),
      minimumMarks: Number(row.minimumMarks),
      confidence: result.confidence,
      reviewRequired: result.reviewRequired,
      teacherOverride: result.teacherOverride,
      subjectKey: suite.subject?.name ?? suite.subjectId ?? "UNSPECIFIED",
      questionType: suite.questionType ?? "UNSPECIFIED",
    };
  });

  const { drift, ...gateThresholds } = thresholds;
  let gate;
  try {
    gate = evaluateAIExaminerBenchmarkGate(benchmarkRows, gateThresholds);
  } catch (error) {
    throw new AppError(422, "AI_EXAMINER_BENCHMARK_RESULT_INVALID", error instanceof Error ? error.message : "Benchmark result is invalid");
  }
  const bySubject = groupAIExaminerBenchmarkMetrics(benchmarkRows, "subjectKey", gateThresholds);
  const byQuestionType = groupAIExaminerBenchmarkMetrics(benchmarkRows, "questionType", gateThresholds);
  const previous = await prisma.aIExaminerBenchmarkRun.findFirst({
    where: { organizationId: req.auth!.organizationId, suiteId: suite.id, status: AIExaminerBenchmarkRunStatus.COMPLETED },
    select: { metrics: true },
    orderBy: { completedAt: "desc" },
  });
  let driftAssessment: ReturnType<typeof assessAIExaminerBenchmarkDrift> | null = null;
  if (drift && previous?.metrics && typeof previous.metrics === "object" && !Array.isArray(previous.metrics)) {
    const priorOverall = benchmarkMetricsSchema.safeParse((previous.metrics as Record<string, unknown>).overall);
    if (priorOverall.success) driftAssessment = assessAIExaminerBenchmarkDrift(priorOverall.data, gate.metrics, drift);
  }

  const metricsPayload = {
    overall: gate.metrics,
    gateFailures: gate.failures,
    bySubject,
    byQuestionType,
    drift: driftAssessment,
  };
  const now = new Date();
  const data = await prisma.$transaction(async tx => {
    const run = await tx.aIExaminerBenchmarkRun.create({
      data: {
        organizationId: req.auth!.organizationId,
        suiteId: suite.id,
        engineVersion: body.engineVersion,
        provider: body.provider ?? null,
        model: body.model ?? null,
        status: AIExaminerBenchmarkRunStatus.COMPLETED,
        thresholds: profileJson(thresholds),
        metrics: profileJson(metricsPayload),
        benchmarkReady: gate.ready && !driftAssessment?.driftDetected,
        createdById: req.auth!.userId,
        startedAt: now,
        completedAt: now,
      },
    });
    await tx.aIExaminerBenchmarkResult.createMany({
      data: cases.map(row => {
        const result = resultMap.get(row.id)!;
        return {
          organizationId: req.auth!.organizationId,
          runId: run.id,
          caseId: row.id,
          aiMarks: result.aiMarks,
          confidence: result.confidence,
          reviewRequired: result.reviewRequired,
          teacherOverride: result.teacherOverride,
          ...(result.diagnostics ? { diagnostics: profileJson(result.diagnostics) } : {}),
          errorCode: result.errorCode ?? null,
        };
      }),
    });
    await tx.auditLog.create({ data: {
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      action: "AI_EXAMINER_BENCHMARK_RUN_RECORDED",
      entity: "AIExaminerBenchmarkRun",
      entityId: run.id,
      metadata: {
        suiteId: suite.id,
        caseCount: cases.length,
        benchmarkReady: run.benchmarkReady,
        gateFailures: gate.failures,
        driftDetected: driftAssessment?.driftDetected ?? false,
      },
    } });
    return run;
  });

  res.status(201).json({
    data: {
      ...data,
      benchmarkGate: gate,
      drift: driftAssessment,
      releaseReady: false,
      releaseReadyReason: "Benchmark readiness is only one release gate; staging, security, tenant isolation and functional QA remain separate requirements.",
    },
  });
});

router.get("/exam-profiles", async (req: AuthRequest, res) => {
  const branches = await visibleProfileBranchIds(req);
  const query = z.object({
    status: z.nativeEnum(AIExaminerExamProfileStatus).optional(),
    branchId: cuid.optional(),
  }).parse(req.query);
  if (query.branchId && branches && !branches.includes(query.branchId)) {
    throw new AppError(403, "BRANCH_FORBIDDEN", "Branch access denied");
  }
  const data = await prisma.aIExaminerExamProfile.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.branchId
        ? { OR: [{ branchId: null }, { branchId: query.branchId }] }
        : branches
          ? { OR: [{ branchId: null }, { branchId: { in: branches } }] }
          : {}),
    },
    select: {
      id: true, branchId: true, code: true, name: true, kind: true, version: true, status: true,
      effectiveFrom: true, effectiveTo: true, approvedAt: true, createdAt: true, updatedAt: true,
    },
    orderBy: [{ code: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  res.json({ data });
});

router.post("/exam-profiles", async (req: AuthRequest, res) => {
  requireExamProfileAdmin(req);
  const body = z.object({ branchId: cuid.nullable().optional(), profile: z.unknown() }).parse(req.body);
  const profile = parseAIExaminerExamProfile(body.profile);
  const branchId = body.branchId ?? null;
  if (req.auth!.role === Role.BRANCH_ADMIN && !branchId) {
    throw new AppError(422, "AI_EXAMINER_PROFILE_BRANCH_REQUIRED", "Branch administrators can create branch-scoped profiles only");
  }
  if (branchId) {
    await branchAccess(req, branchId);
    const branch = await prisma.branch.findFirst({ where: { id: branchId, organizationId: req.auth!.organizationId }, select: { id: true } });
    if (!branch) throw new AppError(422, "INVALID_BRANCH", "Exam profile branch is invalid");
  }
  const existing = await prisma.aIExaminerExamProfile.findFirst({
    where: { organizationId: req.auth!.organizationId, code: profile.code, version: profile.version },
    select: { id: true },
  });
  if (existing) throw new AppError(409, "AI_EXAMINER_PROFILE_EXISTS", "An exam profile with this code and version already exists");
  const data = await prisma.aIExaminerExamProfile.create({
    data: {
      organizationId: req.auth!.organizationId,
      branchId,
      code: profile.code,
      name: profile.name,
      kind: profile.kind,
      version: profile.version,
      config: profileJson(profile),
      effectiveFrom: profile.effectiveFrom ?? null,
      effectiveTo: profile.effectiveTo ?? null,
      createdById: req.auth!.userId,
    },
  });
  await prisma.auditLog.create({ data: {
    organizationId: req.auth!.organizationId,
    actorId: req.auth!.userId,
    action: "AI_EXAMINER_EXAM_PROFILE_CREATED",
    entity: "AIExaminerExamProfile",
    entityId: data.id,
    metadata: { code: data.code, version: data.version, branchId: data.branchId },
  } }).catch(() => null);
  res.status(201).json({ data });
});

router.put("/exam-profiles/:profileId", async (req: AuthRequest, res) => {
  requireExamProfileAdmin(req);
  const profileId = cuid.parse(req.params.profileId);
  const existing = await prisma.aIExaminerExamProfile.findFirst({
    where: { id: profileId, organizationId: req.auth!.organizationId },
  });
  if (!existing) throw new AppError(404, "AI_EXAMINER_PROFILE_NOT_FOUND", "Exam profile not found");
  if (existing.status !== AIExaminerExamProfileStatus.DRAFT) {
    throw new AppError(409, "AI_EXAMINER_PROFILE_IMMUTABLE", "Only draft exam profiles can be edited; create a new version instead");
  }
  if (existing.branchId) await branchAccess(req, existing.branchId);
  if (req.auth!.role === Role.BRANCH_ADMIN && !existing.branchId) {
    throw new AppError(403, "BRANCH_FORBIDDEN", "Organization-wide profiles can only be edited by a super administrator");
  }
  const profile = parseAIExaminerExamProfile(req.body);
  if (profile.code !== existing.code || profile.version !== existing.version) {
    throw new AppError(422, "AI_EXAMINER_PROFILE_IDENTITY_IMMUTABLE", "Profile code and version cannot change after creation");
  }
  const data = await prisma.aIExaminerExamProfile.update({
    where: { id: existing.id },
    data: {
      name: profile.name,
      kind: profile.kind,
      config: profileJson(profile),
      effectiveFrom: profile.effectiveFrom ?? null,
      effectiveTo: profile.effectiveTo ?? null,
    },
  });
  await prisma.auditLog.create({ data: {
    organizationId: req.auth!.organizationId,
    actorId: req.auth!.userId,
    action: "AI_EXAMINER_EXAM_PROFILE_UPDATED",
    entity: "AIExaminerExamProfile",
    entityId: data.id,
    metadata: { code: data.code, version: data.version },
  } }).catch(() => null);
  res.json({ data });
});

router.post("/exam-profiles/:profileId/activate", async (req: AuthRequest, res) => {
  requireExamProfileAdmin(req);
  const profileId = cuid.parse(req.params.profileId);
  const profile = await prisma.aIExaminerExamProfile.findFirst({
    where: { id: profileId, organizationId: req.auth!.organizationId },
  });
  if (!profile) throw new AppError(404, "AI_EXAMINER_PROFILE_NOT_FOUND", "Exam profile not found");
  if (profile.branchId) await branchAccess(req, profile.branchId);
  if (req.auth!.role === Role.BRANCH_ADMIN && !profile.branchId) {
    throw new AppError(403, "BRANCH_FORBIDDEN", "Organization-wide profiles can only be activated by a super administrator");
  }
  if (profile.status !== AIExaminerExamProfileStatus.DRAFT) {
    throw new AppError(409, "AI_EXAMINER_PROFILE_NOT_DRAFT", "Only a draft exam profile can be activated");
  }
  parseAIExaminerExamProfile(profile.config);
  const now = new Date();
  const data = await prisma.$transaction(async tx => {
    await tx.aIExaminerExamProfile.updateMany({
      where: {
        organizationId: req.auth!.organizationId,
        code: profile.code,
        status: AIExaminerExamProfileStatus.ACTIVE,
        id: { not: profile.id },
      },
      data: { status: AIExaminerExamProfileStatus.ARCHIVED },
    });
    const activated = await tx.aIExaminerExamProfile.update({
      where: { id: profile.id },
      data: { status: AIExaminerExamProfileStatus.ACTIVE, approvedById: req.auth!.userId, approvedAt: now },
    });
    await tx.auditLog.create({ data: {
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      action: "AI_EXAMINER_EXAM_PROFILE_ACTIVATED",
      entity: "AIExaminerExamProfile",
      entityId: activated.id,
      metadata: { code: activated.code, version: activated.version, branchId: activated.branchId },
    } });
    return activated;
  });
  res.json({ data });
});

router.post("/examinations/:examinationId/exam-profile", async (req: AuthRequest, res) => {
  const exam = await examinationForManager(req, cuid.parse(req.params.examinationId));
  if (
    exam.status === ExaminationStatus.COMPLETED ||
    exam.status === ExaminationStatus.RESULTS_PUBLISHED ||
    exam.status === ExaminationStatus.ARCHIVED
  ) {
    throw new AppError(409, "AI_EXAMINER_PROFILE_EXAM_LOCKED", "Exam profile cannot change after the examination is completed");
  }
  if (exam.aiExaminerRubrics.some(rubric => rubric.status === AIExaminerRubricStatus.ACTIVE)) {
    throw new AppError(409, "AI_EXAMINER_PROFILE_RUBRIC_ACTIVE", "Archive or replace the active rubric before changing the exam profile");
  }
  const { profileId } = z.object({ profileId: cuid }).parse(req.body);
  const profile = await prisma.aIExaminerExamProfile.findFirst({
    where: {
      id: profileId,
      organizationId: req.auth!.organizationId,
      status: AIExaminerExamProfileStatus.ACTIVE,
      OR: [{ branchId: null }, { branchId: exam.branchId }],
    },
  });
  if (!profile) throw new AppError(422, "AI_EXAMINER_PROFILE_UNAVAILABLE", "Select an active organization-wide or examination-branch profile");
  const snapshot = {
    id: profile.id,
    code: profile.code,
    name: profile.name,
    kind: profile.kind,
    version: profile.version,
    branchId: profile.branchId,
    effectiveFrom: profile.effectiveFrom,
    effectiveTo: profile.effectiveTo,
    config: profile.config,
    approvedAt: profile.approvedAt,
  };
  const data = await prisma.examination.update({
    where: { id: exam.id },
    data: {
      aiExaminerExamProfileId: profile.id,
      aiExaminerExamProfileSnapshot: profileJson(snapshot),
    },
    select: { id: true, aiExaminerExamProfileId: true, aiExaminerExamProfileSnapshot: true, updatedAt: true },
  });
  await prisma.auditLog.create({ data: {
    organizationId: req.auth!.organizationId,
    actorId: req.auth!.userId,
    action: "AI_EXAMINER_EXAM_PROFILE_ASSIGNED",
    entity: "Examination",
    entityId: exam.id,
    metadata: { profileId: profile.id, code: profile.code, version: profile.version },
  } }).catch(() => null);
  res.json({ data });
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
      subject: { select: { id: true, name: true, code: true } }, batch: { select: { id: true, name: true } }, branch: { select: { id: true, branchName: true } },
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

const aiExaminerEvidenceKindSchema = z.enum(["AUDIO","VIDEO","IMAGE","DOCUMENT","EXTERNAL_REFERENCE","STRUCTURED_OBSERVATION"]);
const aiExaminerEvidenceInputSchema = z.object({
  questionKey: z.string().trim().min(1).max(80),
  kind: aiExaminerEvidenceKindSchema,
  fileName: z.string().trim().min(1).max(255).optional(),
  mimeType: z.enum(aiExaminerEvidenceMimeTypes).optional(),
  base64: z.string().min(4).optional(),
  externalUrl: z.string().trim().max(2048).optional(),
  durationSeconds: z.coerce.number().int().min(1).max(8 * 60 * 60).optional(),
  transcript: z.string().max(100000).optional(),
  observation: z.record(z.string(), z.unknown()).optional(),
  sourceDevice: z.string().trim().max(160).optional(),
  capturedAt: z.coerce.date().optional(),
  identityMasked: z.boolean().default(false),
}).superRefine((value, ctx) => {
  const uploadKinds = new Set(["AUDIO","VIDEO","IMAGE","DOCUMENT"]);
  if (uploadKinds.has(value.kind)) {
    for (const field of ["fileName","mimeType","base64"] as const) {
      if (!value[field]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} is required for uploaded evidence` });
    }
  }
  if (value.kind === "EXTERNAL_REFERENCE" && !value.externalUrl) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["externalUrl"], message: "externalUrl is required for external evidence" });
  }
  if (value.kind === "STRUCTURED_OBSERVATION" && !value.observation) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["observation"], message: "observation is required for structured evidence" });
  }
});

router.post("/answer-sheets/:answerSheetId/evidence", async (req: AuthRequest, res) => {
  const answerSheetId = cuid.parse(req.params.answerSheetId);
  const { sheet, exam } = await answerSheetForManager(req, answerSheetId);
  const body = aiExaminerEvidenceInputSchema.parse(req.body);
  const activeRubric = exam.aiExaminerRubrics.find(rubric => rubric.status === AIExaminerRubricStatus.ACTIVE);
  if (!activeRubric) throw new AppError(409, "AI_EXAMINER_RUBRIC_REQUIRED", "Activate a marking rubric before attaching question evidence");
  const rubricQuestions = resolveAIExaminerRubricQuestions(activeRubric.rubric, activeRubric.modelAnswer);
  const rubricQuestion = rubricQuestions.find(question => question.key.toLocaleLowerCase("en") === body.questionKey.toLocaleLowerCase("en"));
  if (!rubricQuestion) throw new AppError(422, "AI_EXAMINER_EVIDENCE_QUESTION_INVALID", "Evidence question key is not present in the active rubric");

  let fileData: Uint8Array<ArrayBuffer> | undefined;
  let fileSize: number | undefined;
  let contentSha256: string | undefined;
  let externalUrl: string | undefined;
  if (body.fileName && body.mimeType && body.base64) {
    assertAIExaminerEvidenceKindMatchesMime(body.kind, body.mimeType);
    const decoded = decodeAIExaminerEvidenceUpload({
      base64: body.base64,
      fileName: body.fileName,
      mimeType: body.mimeType,
      maximumBytes: 10 * 1024 * 1024,
    });
    fileData = decoded.bytes as unknown as Uint8Array<ArrayBuffer>;
    fileSize = decoded.bytes.length;
    contentSha256 = decoded.contentSha256;
  } else if (body.externalUrl) {
    externalUrl = normalizeAIExaminerEvidenceUrl(body.externalUrl);
  }

  const evidence = await prisma.aIExaminerEvidenceAttachment.create({
    data: {
      organizationId: req.auth!.organizationId,
      answerSheetId: sheet.id,
      questionKey: rubricQuestion.key,
      kind: body.kind,
      fileName: body.fileName,
      mimeType: body.mimeType,
      fileSize,
      fileData,
      externalUrl,
      contentSha256,
      durationSeconds: body.durationSeconds,
      transcript: body.transcript?.trim() || undefined,
      observation: body.observation ? profileJson(body.observation) : undefined,
      sourceDevice: body.sourceDevice,
      capturedAt: body.capturedAt,
      identityMasked: body.identityMasked,
      uploadedById: req.auth!.userId,
    },
    select: {
      id: true, answerSheetId: true, questionKey: true, kind: true, status: true, fileName: true, mimeType: true, fileSize: true,
      externalUrl: true, contentSha256: true, durationSeconds: true, transcript: true, observation: true, sourceDevice: true, capturedAt: true, identityMasked: true,
      uploadedById: true, reviewedById: true, reviewNotes: true, reviewedAt: true, createdAt: true, updatedAt: true,
    },
  });
  await prisma.auditLog.create({
    data: {
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      action: "AI_EXAMINER_EVIDENCE_ADDED",
      entity: "AIExaminerEvidenceAttachment",
      entityId: evidence.id,
      metadata: {
        answerSheetId: sheet.id,
        examinationId: exam.id,
        questionKey: evidence.questionKey,
        kind: evidence.kind,
        contentSha256: evidence.contentSha256 ?? null,
      },
    },
  });
  res.status(201).json({
    data: evidence,
    meta: {
      automaticScoring: false,
      reviewRequired: true,
      guidance: "Supplementary oral/practical evidence is review material and does not independently finalize marks.",
    },
  });
});

router.get("/answer-sheets/:answerSheetId/evidence", async (req: AuthRequest, res) => {
  const answerSheetId = cuid.parse(req.params.answerSheetId);
  await answerSheetForManager(req, answerSheetId);
  const data = await prisma.aIExaminerEvidenceAttachment.findMany({
    where: { organizationId: req.auth!.organizationId, answerSheetId },
    select: {
      id: true, answerSheetId: true, questionKey: true, kind: true, status: true, fileName: true, mimeType: true, fileSize: true,
      externalUrl: true, contentSha256: true, durationSeconds: true, transcript: true, observation: true, sourceDevice: true, capturedAt: true, identityMasked: true,
      uploadedById: true, reviewedById: true, reviewNotes: true, reviewedAt: true, createdAt: true, updatedAt: true,
    },
    orderBy: [{ questionKey: "asc" }, { createdAt: "asc" }],
  });
  res.json({
    data,
    meta: {
      automaticScoring: false,
      interpretation: "Evidence must be considered by an authorized human reviewer in the context of the active rubric.",
    },
  });
});

router.get("/evidence/:evidenceId/file", async (req: AuthRequest, res) => {
  const evidenceId = cuid.parse(req.params.evidenceId);
  const evidence = await prisma.aIExaminerEvidenceAttachment.findFirst({
    where: { id: evidenceId, organizationId: req.auth!.organizationId },
    select: { id: true, answerSheetId: true, fileName: true, mimeType: true, fileSize: true, fileData: true },
  });
  if (!evidence) throw new AppError(404, "AI_EXAMINER_EVIDENCE_NOT_FOUND", "Evidence attachment not found");
  await answerSheetForManager(req, evidence.answerSheetId);
  if (!evidence.fileData || !evidence.fileName || !evidence.mimeType || !evidence.fileSize) {
    throw new AppError(404, "AI_EXAMINER_EVIDENCE_FILE_NOT_FOUND", "This evidence record does not contain an uploaded file");
  }
  res.set(storedDocumentHeaders({
    fileName: evidence.fileName,
    mimeType: evidence.mimeType,
    fileSize: evidence.fileSize,
    fallbackName: "ai-examiner-evidence",
  }, "inline"));
  res.send(storedDocumentBuffer(evidence.fileData));
});

router.patch("/evidence/:evidenceId/review", async (req: AuthRequest, res) => {
  const evidenceId = cuid.parse(req.params.evidenceId);
  const body = z.object({
    status: z.enum(["VERIFIED","REJECTED"]),
    reviewNotes: z.string().trim().min(3).max(10000),
  }).parse(req.body);
  const evidence = await prisma.aIExaminerEvidenceAttachment.findFirst({
    where: { id: evidenceId, organizationId: req.auth!.organizationId },
    select: { id: true, answerSheetId: true, status: true },
  });
  if (!evidence) throw new AppError(404, "AI_EXAMINER_EVIDENCE_NOT_FOUND", "Evidence attachment not found");
  await answerSheetForManager(req, evidence.answerSheetId);
  const updated = await prisma.aIExaminerEvidenceAttachment.update({
    where: { id: evidence.id },
    data: {
      status: body.status,
      reviewNotes: body.reviewNotes,
      reviewedById: req.auth!.userId,
      reviewedAt: new Date(),
    },
    select: {
      id: true, answerSheetId: true, questionKey: true, kind: true, status: true, fileName: true, mimeType: true, fileSize: true,
      externalUrl: true, contentSha256: true, durationSeconds: true, transcript: true, observation: true, sourceDevice: true, capturedAt: true, identityMasked: true,
      uploadedById: true, reviewedById: true, reviewNotes: true, reviewedAt: true, createdAt: true, updatedAt: true,
    },
  });
  await prisma.auditLog.create({
    data: {
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      action: body.status === "VERIFIED" ? "AI_EXAMINER_EVIDENCE_VERIFIED" : "AI_EXAMINER_EVIDENCE_REJECTED",
      entity: "AIExaminerEvidenceAttachment",
      entityId: evidence.id,
      metadata: { answerSheetId: evidence.answerSheetId },
    },
  });
  res.json({ data: updated, meta: { automaticScoring: false } });
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


router.get("/evaluations/:evaluationId/checked-copy", async (req: AuthRequest, res) => {
  const evaluationId = cuid.parse(req.params.evaluationId);
  const evaluation = await prisma.aIExaminerEvaluation.findFirst({
    where: {
      id: evaluationId,
      organizationId: req.auth!.organizationId,
      status: AIExaminerEvaluationStatus.APPROVED,
    },
    include: {
      questions: { orderBy: { createdAt: "asc" } },
      reviewedBy: { select: { id: true, name: true } },
      answerSheet: {
        select: {
          id: true,
          examinationId: true,
          fileName: true,
          mimeType: true,
          fileData: true,
          finalizedAt: true,
          marksObtained: true,
          student: { select: { user: { select: { name: true } } } },
          examination: { select: { name: true, maximumMarks: true } },
        },
      },
    },
  });
  if (!evaluation) throw new AppError(404, "AI_EXAMINER_CHECKED_COPY_NOT_FOUND", "Approved AI evaluation not found");
  await examinationForManager(req, evaluation.answerSheet.examinationId);
  if (!evaluation.answerSheet.finalizedAt || evaluation.answerSheet.marksObtained == null) {
    throw new AppError(409, "AI_EXAMINER_CHECKED_COPY_NOT_FINAL", "Checked copy is available only after teacher approval and answer-sheet finalization");
  }
  if (evaluation.questions.some(question => question.finalMarks == null)) {
    throw new AppError(409, "AI_EXAMINER_CHECKED_COPY_MARKS_INCOMPLETE", "Checked copy requires teacher-approved final marks for every question");
  }

  const rendered = await renderAIExaminerCheckedCopy({
    source: {
      fileName: evaluation.answerSheet.fileName,
      mimeType: evaluation.answerSheet.mimeType,
      bytes: Buffer.from(evaluation.answerSheet.fileData),
    },
    studentName: evaluation.answerSheet.student.user.name,
    examinationName: evaluation.answerSheet.examination.name,
    questions: evaluation.questions.map(question => ({
      questionKey: question.questionKey,
      maxMarks: Number(question.maxMarks),
      finalMarks: Number(question.finalMarks),
      teacherComment: question.teacherComment,
      feedback: question.feedback,
    })),
    diagnostics: evaluation.diagnostics,
    totalMarks: Number(evaluation.answerSheet.marksObtained),
    maximumMarks: evaluation.answerSheet.examination.maximumMarks,
    reviewerName: evaluation.reviewedBy?.name ?? null,
    evaluationRevision: evaluation.revision,
  });

  await prisma.auditLog.create({
    data: {
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      action: "AI_EXAMINER_CHECKED_COPY_DOWNLOADED",
      entity: "AIExaminerEvaluation",
      entityId: evaluation.id,
      metadata: {
        answerSheetId: evaluation.answerSheet.id,
        placement: rendered.placement,
        pageCount: rendered.pageCount,
        exactHintCount: rendered.exactHintCount,
      },
    },
  }).catch(() => null);

  const baseName = evaluation.answerSheet.fileName.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 120) || "answer-sheet";
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${baseName}-checked.pdf"`,
    "Cache-Control": "private, no-store",
    "X-Checked-Copy-Placement": rendered.placement,
    "X-Checked-Copy-Pages": String(rendered.pageCount),
  }).send(rendered.pdf);
});

router.post("/examinations/:examinationId/scan-batches", async (req: AuthRequest, res) => {
  const examinationId = cuid.parse(req.params.examinationId);
  const exam = await examinationForManager(req, examinationId);
  if (exam.status !== ExaminationStatus.COMPLETED) {
    throw new AppError(409, "AI_EXAMINER_SCAN_EXAM_NOT_COMPLETED", "Bulk scan routing is available after the examination is completed");
  }
  const activeRubric = exam.aiExaminerRubrics.find(rubric => rubric.status === AIExaminerRubricStatus.ACTIVE) ?? null;
  if (!activeRubric) throw new AppError(409, "AI_EXAMINER_ACTIVE_RUBRIC_REQUIRED", "Activate a marking rubric before bulk scan routing");
  const resolved = resolveAIExaminerRubricQuestions(activeRubric.rubric, activeRubric.modelAnswer);
  const omrQuestions = resolved
    .filter(question => (question.questionType === "MCQ" || question.questionType === "MSQ") && question.omrValidation)
    .map(question => ({
      questionKey: question.key,
      mode: question.questionType as "MCQ" | "MSQ",
      allowedOptions: question.omrValidation!.allowedOptions,
    }));

  const pageSchema = z.object({
    sourcePageNumber: z.coerce.number().int().min(1).max(10000),
    scanId: z.string().trim().min(1).max(160),
    barcodeToken: z.string().trim().min(32).max(256),
    barcodeConfidence: z.coerce.number().min(0).max(1),
    imageQuality: z.coerce.number().min(0).max(1),
    targetPageNumber: z.coerce.number().int().min(1).max(1000),
    targetTotalPages: z.coerce.number().int().min(1).max(1000),
    detections: z.array(z.object({
      questionKey: z.string().trim().min(1).max(40),
      selections: z.array(z.string().trim().min(1).max(40)).max(20),
      confidence: z.coerce.number().min(0).max(1),
      ambiguous: z.boolean().optional(),
    })).max(500).default([]),
  }).superRefine((value, ctx) => {
    if (value.targetPageNumber > value.targetTotalPages) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["targetPageNumber"], message: "targetPageNumber cannot exceed targetTotalPages" });
    }
  });
  const body = z.object({
    externalBatchId: z.string().trim().min(1).max(180).optional(),
    scannerEngine: z.string().trim().min(1).max(160),
    scannerVersion: z.string().trim().min(1).max(80),
    pages: z.array(pageSchema).min(1).max(2000),
  }).superRefine((value, ctx) => {
    const source = new Set<number>();
    const scanIds = new Set<string>();
    for (const [index, page] of value.pages.entries()) {
      if (source.has(page.sourcePageNumber)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pages", index, "sourcePageNumber"], message: "sourcePageNumber must be unique inside a batch" });
      if (scanIds.has(page.scanId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pages", index, "scanId"], message: "scanId must be unique inside a batch" });
      source.add(page.sourcePageNumber);
      scanIds.add(page.scanId);
    }
  }).parse(req.body);

  if (!omrQuestions.length && body.pages.some(page => page.detections.length)) {
    throw new AppError(422, "AI_EXAMINER_OMR_NOT_CONFIGURED", "The active rubric has no MCQ/MSQ questions with OMR option configuration");
  }

  if (body.externalBatchId) {
    const existing = await prisma.aIExaminerScanBatch.findFirst({
      where: { organizationId: req.auth!.organizationId, externalBatchId: body.externalBatchId },
      include: { pages: { orderBy: { sourcePageNumber: "asc" } } },
    });
    if (existing) {
      if (existing.examinationId !== exam.id) throw new AppError(409, "AI_EXAMINER_SCAN_BATCH_REUSED", "externalBatchId is already used for another examination");
      return res.status(200).json({ data: existing, meta: { duplicate: true } });
    }
  }

  const batch = await prisma.aIExaminerScanBatch.create({
    data: {
      organizationId: req.auth!.organizationId,
      examinationId: exam.id,
      externalBatchId: body.externalBatchId,
      scannerEngine: body.scannerEngine,
      scannerVersion: body.scannerVersion,
      totalPages: body.pages.length,
      createdById: req.auth!.userId,
    },
    select: { id: true, examinationId: true, externalBatchId: true, scannerEngine: true, scannerVersion: true, totalPages: true, status: true, createdAt: true },
  });

  let routedPages = 0;
  let reviewPages = 0;
  let rejectedPages = 0;
  const routedBindings = new Set<string>();

  for (const source of body.pages.sort((a, b) => a.sourcePageNumber - b.sourcePageNumber)) {
    const tokenHash = hashAIExaminerScanToken(source.barcodeToken);
    const binding = await prisma.aIExaminerScanBinding.findFirst({
      where: { organizationId: req.auth!.organizationId, tokenHash },
      include: { answerSheet: { select: { id: true, examinationId: true, finalizedAt: true } } },
    });

    let batchPageStatus: AIExaminerScanBatchPageStatus = AIExaminerScanBatchPageStatus.REJECTED;
    let issueCodes: string[] = [];
    let routedScanPageId: string | null = null;

    if (!binding) {
      issueCodes = ["UNKNOWN_BARCODE_TOKEN"];
      rejectedPages += 1;
    } else if (binding.answerSheet.examinationId !== exam.id) {
      issueCodes = ["BARCODE_EXAMINATION_MISMATCH"];
      rejectedPages += 1;
    } else if (binding.answerSheet.finalizedAt) {
      issueCodes = ["ANSWER_SHEET_FINALIZED"];
      rejectedPages += 1;
    } else if (binding.status !== AIExaminerScanBindingStatus.ACTIVE) {
      issueCodes = ["SCAN_BINDING_LOCKED"];
      rejectedPages += 1;
    } else {
      const reusedScanId = await prisma.aIExaminerScanPage.findFirst({
        where: {
          organizationId: req.auth!.organizationId,
          scanId: source.scanId,
          NOT: { bindingId: binding.id, pageNumber: source.targetPageNumber },
        },
        select: { id: true },
      });
      if (reusedScanId) {
        issueCodes = ["SCAN_ID_REUSED"];
        rejectedPages += 1;
      } else {
        const validation = validateAIExaminerOmrIngestion({
          payload: {
            scanId: source.scanId,
            scannerEngine: body.scannerEngine,
            scannerVersion: body.scannerVersion,
            pageNumber: source.targetPageNumber,
            totalPages: source.targetTotalPages,
            scanToken: "[redacted]",
            barcodeConfidence: source.barcodeConfidence,
            imageQuality: source.imageQuality,
            detections: source.detections,
          },
          questions: omrQuestions,
        });
        const pageStatus = validation.status === "ACCEPTED" ? AIExaminerScanPageStatus.ACCEPTED : AIExaminerScanPageStatus.REVIEW_REQUIRED;
        issueCodes = validation.issues.map(issue => issue.code);
        const scanPage = await prisma.aIExaminerScanPage.upsert({
          where: { bindingId_pageNumber: { bindingId: binding.id, pageNumber: source.targetPageNumber } },
          update: {
            scanId: source.scanId,
            totalPages: source.targetTotalPages,
            scannerEngine: body.scannerEngine,
            scannerVersion: body.scannerVersion,
            barcodeConfidence: source.barcodeConfidence,
            imageQuality: source.imageQuality,
            status: pageStatus,
            payload: profileJson({
              scanId: source.scanId,
              scannerEngine: body.scannerEngine,
              scannerVersion: body.scannerVersion,
              pageNumber: source.targetPageNumber,
              totalPages: source.targetTotalPages,
              scanToken: "[redacted]",
              barcodeConfidence: source.barcodeConfidence,
              imageQuality: source.imageQuality,
              detections: source.detections,
              bulkBatchId: batch.id,
              sourcePageNumber: source.sourcePageNumber,
            }),
            validationResult: profileJson(validation),
            ingestedById: req.auth!.userId,
          },
          create: {
            organizationId: req.auth!.organizationId,
            bindingId: binding.id,
            scanId: source.scanId,
            pageNumber: source.targetPageNumber,
            totalPages: source.targetTotalPages,
            scannerEngine: body.scannerEngine,
            scannerVersion: body.scannerVersion,
            barcodeConfidence: source.barcodeConfidence,
            imageQuality: source.imageQuality,
            status: pageStatus,
            payload: profileJson({
              scanId: source.scanId,
              scannerEngine: body.scannerEngine,
              scannerVersion: body.scannerVersion,
              pageNumber: source.targetPageNumber,
              totalPages: source.targetTotalPages,
              scanToken: "[redacted]",
              barcodeConfidence: source.barcodeConfidence,
              imageQuality: source.imageQuality,
              detections: source.detections,
              bulkBatchId: batch.id,
              sourcePageNumber: source.sourcePageNumber,
            }),
            validationResult: profileJson(validation),
            ingestedById: req.auth!.userId,
          },
          select: { id: true },
        });
        routedScanPageId = scanPage.id;
        routedBindings.add(binding.id);
        if (pageStatus === AIExaminerScanPageStatus.ACCEPTED) {
          batchPageStatus = AIExaminerScanBatchPageStatus.ROUTED;
          routedPages += 1;
        } else {
          batchPageStatus = AIExaminerScanBatchPageStatus.REVIEW_REQUIRED;
          reviewPages += 1;
        }
      }
    }

    await prisma.aIExaminerScanBatchPage.create({
      data: {
        organizationId: req.auth!.organizationId,
        batchId: batch.id,
        sourcePageNumber: source.sourcePageNumber,
        scanId: source.scanId,
        bindingId: binding?.id ?? null,
        answerSheetId: binding?.answerSheet.id ?? null,
        targetPageNumber: binding ? source.targetPageNumber : null,
        targetTotalPages: binding ? source.targetTotalPages : null,
        barcodeConfidence: source.barcodeConfidence,
        imageQuality: source.imageQuality,
        status: batchPageStatus,
        issueCodes,
        routedScanPageId,
        metadata: profileJson({
          barcodeToken: "[redacted]",
          detectionCount: source.detections.length,
        }),
      },
    });
  }

  for (const bindingId of routedBindings) {
    const pages = await prisma.aIExaminerScanPage.findMany({
      where: { organizationId: req.auth!.organizationId, bindingId },
      select: { pageNumber: true, totalPages: true, status: true },
    });
    if (!pages.length) continue;
    const totalPages = pages[0]!.totalPages;
    const sameTotal = pages.every(page => page.totalPages === totalPages);
    const numbers = new Set(pages.map(page => page.pageNumber));
    const complete = sameTotal && pages.length === totalPages && Array.from({ length: totalPages }, (_, index) => index + 1).every(page => numbers.has(page));
    if (complete && pages.every(page => page.status === AIExaminerScanPageStatus.ACCEPTED)) {
      await prisma.aIExaminerScanBinding.updateMany({
        where: { id: bindingId, organizationId: req.auth!.organizationId, status: AIExaminerScanBindingStatus.ACTIVE },
        data: { status: AIExaminerScanBindingStatus.LOCKED },
      });
    }
  }

  const status = reviewPages || rejectedPages ? AIExaminerScanBatchStatus.REVIEW_REQUIRED : AIExaminerScanBatchStatus.ROUTED;
  const completed = await prisma.aIExaminerScanBatch.update({
    where: { id: batch.id },
    data: { status, routedPages, reviewPages, rejectedPages, completedAt: new Date() },
    include: { pages: { orderBy: { sourcePageNumber: "asc" } } },
  });
  await prisma.auditLog.create({
    data: {
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      action: "AI_EXAMINER_BULK_SCAN_ROUTED",
      entity: "AIExaminerScanBatch",
      entityId: batch.id,
      metadata: {
        examinationId: exam.id,
        totalPages: body.pages.length,
        routedPages,
        reviewPages,
        rejectedPages,
        scannerEngine: body.scannerEngine,
        scannerVersion: body.scannerVersion,
      },
    },
  });
  res.status(201).json({ data: completed });
});

router.get("/examinations/:examinationId/scan-batches", async (req: AuthRequest, res) => {
  const examinationId = cuid.parse(req.params.examinationId);
  await examinationForManager(req, examinationId);
  const data = await prisma.aIExaminerScanBatch.findMany({
    where: { organizationId: req.auth!.organizationId, examinationId },
    include: { pages: { orderBy: { sourcePageNumber: "asc" } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json({ data });
});

router.post("/answer-sheets/:answerSheetId/scan-binding", async (req: AuthRequest, res) => {
  const answerSheetId = cuid.parse(req.params.answerSheetId);
  const { sheet, exam } = await answerSheetForManager(req, answerSheetId);

  if (sheet.finalizedAt) throw new AppError(409, "AI_EXAMINER_ANSWER_FINALIZED", "Finalized answer sheets cannot create or rotate scan bindings");
  if (sheet.status !== AnswerSheetStatus.SUBMITTED && sheet.status !== AnswerSheetStatus.LATE_SUBMITTED) {
    throw new AppError(409, "AI_EXAMINER_SCAN_BINDING_UNAVAILABLE", "Scan binding requires an answer sheet that has been submitted and is not already under review");
  }
  if (exam.status !== ExaminationStatus.COMPLETED) {
    throw new AppError(409, "AI_EXAMINER_SCAN_EXAM_NOT_COMPLETED", "OMR scan binding is available after the examination is completed");
  }

  const existing = await prisma.aIExaminerScanBinding.findFirst({
    where: { organizationId: req.auth!.organizationId, answerSheetId },
    include: { _count: { select: { pages: true } } },
  });
  if (existing?._count.pages) {
    throw new AppError(409, "AI_EXAMINER_SCAN_BINDING_LOCKED", "A scan binding with ingested pages cannot rotate its token");
  }

  const scanToken = createAIExaminerScanToken();
  const tokenHash = hashAIExaminerScanToken(scanToken);
  const data = await prisma.$transaction(async tx => {
    const binding = await tx.aIExaminerScanBinding.upsert({
      where: { answerSheetId },
      update: {
        tokenHash,
        status: AIExaminerScanBindingStatus.ACTIVE,
        createdById: req.auth!.userId,
      },
      create: {
        organizationId: req.auth!.organizationId,
        answerSheetId,
        tokenHash,
        status: AIExaminerScanBindingStatus.ACTIVE,
        createdById: req.auth!.userId,
      },
      select: { id: true, answerSheetId: true, status: true, createdAt: true, updatedAt: true },
    });
    await tx.auditLog.create({
      data: {
        organizationId: req.auth!.organizationId,
        actorId: req.auth!.userId,
        action: existing ? "AI_EXAMINER_SCAN_BINDING_ROTATED" : "AI_EXAMINER_SCAN_BINDING_CREATED",
        entity: "AIExaminerScanBinding",
        entityId: binding.id,
        metadata: { answerSheetId, examinationId: exam.id },
      },
    });
    return binding;
  });

  res.status(existing ? 200 : 201).json({
    data: {
      ...data,
      scanToken,
      tokenHandling: "Store/print this opaque token in the QR/barcode. The server stores only its SHA-256 hash and will not return the token again.",
    },
  });
});

router.post("/scan-bindings/:bindingId/pages", async (req: AuthRequest, res) => {
  const bindingId = cuid.parse(req.params.bindingId);
  const body = z.object({
    scanId: z.string().trim().min(1).max(160),
    scannerEngine: z.string().trim().min(1).max(160),
    scannerVersion: z.string().trim().min(1).max(80),
    pageNumber: z.coerce.number().int().min(1).max(1000),
    totalPages: z.coerce.number().int().min(1).max(1000),
    scanToken: z.string().trim().min(32).max(256),
    barcodeConfidence: z.coerce.number().min(0).max(1),
    imageQuality: z.coerce.number().min(0).max(1),
    detections: z.array(z.object({
      questionKey: z.string().trim().min(1).max(40),
      selections: z.array(z.string().trim().min(1).max(40)).max(20),
      confidence: z.coerce.number().min(0).max(1),
      ambiguous: z.boolean().optional(),
    })).max(500),
  }).superRefine((value, ctx) => {
    if (value.pageNumber > value.totalPages) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pageNumber"], message: "pageNumber cannot exceed totalPages" });
    }
  }).parse(req.body);

  const binding = await prisma.aIExaminerScanBinding.findFirst({
    where: { id: bindingId, organizationId: req.auth!.organizationId },
    include: {
      pages: { select: { id: true, pageNumber: true, totalPages: true, scanId: true, status: true } },
      answerSheet: { select: { id: true, examinationId: true, finalizedAt: true } },
    },
  });
  if (!binding) throw new AppError(404, "AI_EXAMINER_SCAN_BINDING_NOT_FOUND", "Scan binding not found");
  if (binding.status !== AIExaminerScanBindingStatus.ACTIVE) {
    throw new AppError(409, "AI_EXAMINER_SCAN_BINDING_LOCKED", "Scan binding is no longer open for page ingestion");
  }
  assertAIExaminerScanToken(binding.tokenHash, body.scanToken);

  const { sheet, exam } = await answerSheetForManager(req, binding.answerSheetId);
  if (sheet.finalizedAt || binding.answerSheet.finalizedAt) throw new AppError(409, "AI_EXAMINER_ANSWER_FINALIZED", "Finalized answer sheets cannot ingest scan pages");
  if (exam.status !== ExaminationStatus.COMPLETED) {
    throw new AppError(409, "AI_EXAMINER_SCAN_EXAM_NOT_COMPLETED", "OMR scan ingestion is available after the examination is completed");
  }

  const activeRubric = exam.aiExaminerRubrics.find(rubric => rubric.status === AIExaminerRubricStatus.ACTIVE) ?? null;
  if (!activeRubric) throw new AppError(409, "AI_EXAMINER_ACTIVE_RUBRIC_REQUIRED", "Activate a marking rubric before OMR scan ingestion");
  const resolved = resolveAIExaminerRubricQuestions(activeRubric.rubric, activeRubric.modelAnswer);
  const questions = resolved
    .filter(question => (question.questionType === "MCQ" || question.questionType === "MSQ") && question.omrValidation)
    .map(question => ({
      questionKey: question.key,
      mode: question.questionType as "MCQ" | "MSQ",
      allowedOptions: question.omrValidation!.allowedOptions,
    }));
  if (!questions.length) {
    throw new AppError(422, "AI_EXAMINER_OMR_NOT_CONFIGURED", "The active rubric has no MCQ/MSQ questions with OMR option configuration");
  }

  const differentPageCount = binding.pages.some(page => page.totalPages !== body.totalPages);
  if (differentPageCount) {
    throw new AppError(422, "AI_EXAMINER_SCAN_PAGE_COUNT_MISMATCH", "All pages for a scan binding must declare the same totalPages value");
  }
  const reusedScanId = await prisma.aIExaminerScanPage.findFirst({
    where: {
      organizationId: req.auth!.organizationId,
      scanId: body.scanId,
      NOT: { bindingId: binding.id, pageNumber: body.pageNumber },
    },
    select: { id: true },
  });
  if (reusedScanId) {
    throw new AppError(409, "AI_EXAMINER_SCAN_ID_REUSED", "scanId is already associated with a different scan page");
  }

  const validation = validateAIExaminerOmrIngestion({
    payload: body,
    questions,
  });
  const pageStatus = validation.status === "ACCEPTED"
    ? AIExaminerScanPageStatus.ACCEPTED
    : AIExaminerScanPageStatus.REVIEW_REQUIRED;
  const redactedPayload = { ...body, scanToken: "[redacted]" };

  const data = await prisma.$transaction(async tx => {
    const page = await tx.aIExaminerScanPage.upsert({
      where: { bindingId_pageNumber: { bindingId: binding.id, pageNumber: body.pageNumber } },
      update: {
        scanId: body.scanId,
        totalPages: body.totalPages,
        scannerEngine: body.scannerEngine,
        scannerVersion: body.scannerVersion,
        barcodeConfidence: body.barcodeConfidence,
        imageQuality: body.imageQuality,
        status: pageStatus,
        payload: profileJson(redactedPayload),
        validationResult: profileJson(validation),
        ingestedById: req.auth!.userId,
      },
      create: {
        organizationId: req.auth!.organizationId,
        bindingId: binding.id,
        scanId: body.scanId,
        pageNumber: body.pageNumber,
        totalPages: body.totalPages,
        scannerEngine: body.scannerEngine,
        scannerVersion: body.scannerVersion,
        barcodeConfidence: body.barcodeConfidence,
        imageQuality: body.imageQuality,
        status: pageStatus,
        payload: profileJson(redactedPayload),
        validationResult: profileJson(validation),
        ingestedById: req.auth!.userId,
      },
      select: { id: true, pageNumber: true, totalPages: true, scanId: true, status: true, createdAt: true, updatedAt: true },
    });

    const pages = await tx.aIExaminerScanPage.findMany({
      where: { organizationId: req.auth!.organizationId, bindingId: binding.id },
      select: { pageNumber: true, totalPages: true, status: true },
    });
    const pageNumbers = new Set(pages.map(item => item.pageNumber));
    const complete = pages.length === body.totalPages &&
      Array.from({ length: body.totalPages }, (_, index) => index + 1).every(pageNumber => pageNumbers.has(pageNumber));
    const allAccepted = complete && pages.every(item => item.status === AIExaminerScanPageStatus.ACCEPTED);
    if (allAccepted) {
      await tx.aIExaminerScanBinding.update({
        where: { id: binding.id },
        data: { status: AIExaminerScanBindingStatus.LOCKED },
      });
    }

    await tx.auditLog.create({
      data: {
        organizationId: req.auth!.organizationId,
        actorId: req.auth!.userId,
        action: "AI_EXAMINER_OMR_SCAN_PAGE_INGESTED",
        entity: "AIExaminerScanPage",
        entityId: page.id,
        metadata: {
          bindingId: binding.id,
          answerSheetId: binding.answerSheetId,
          pageNumber: body.pageNumber,
          totalPages: body.totalPages,
          scannerEngine: body.scannerEngine,
          scannerVersion: body.scannerVersion,
          status: pageStatus,
          issueCodes: validation.issues.map(issue => issue.code),
          bindingLocked: allAccepted,
        },
      },
    });

    return { page, bindingLocked: allAccepted };
  });

  res.json({ data: data.page, validation, meta: { bindingLocked: data.bindingLocked } });
});

router.put("/evaluations/:evaluationId/review-artifact", async (req: AuthRequest, res) => {
  const evaluationId = cuid.parse(req.params.evaluationId);
  const body = z.object({
    fileName: z.string().trim().min(1).max(180),
    mimeType: z.enum(allowedAnswerSheetTypes),
    base64: z.string().min(1).max(14_000_000, "File must not exceed 10 MB"),
    identityMaskingConfirmed: z.literal(true),
  }).parse(req.body);

  assertDocumentFileExtension(body.fileName, body.mimeType);
  const fileData = decodeVerifiedUpload(body.base64, body.mimeType);

  const evaluation = await prisma.aIExaminerEvaluation.findFirst({
    where: { id: evaluationId, organizationId: req.auth!.organizationId },
    include: {
      answerSheet: { select: { examinationId: true, finalizedAt: true } },
      reviewArtifact: { select: { id: true } },
      reviewRounds: {
        where: { anonymizeStudentIdentity: true, status: { not: AIExaminerReviewRoundStatus.CANCELLED } },
        select: { id: true, status: true },
      },
    },
  });
  if (!evaluation) throw new AppError(404, "AI_EXAMINER_EVALUATION_NOT_FOUND", "AI evaluation not found");
  if (evaluation.status !== AIExaminerEvaluationStatus.REVIEW_REQUIRED) {
    throw new AppError(409, "AI_EXAMINER_REVIEW_ARTIFACT_UNAVAILABLE", "An anonymized review artifact can only be prepared while the evaluation awaits review");
  }
  if (evaluation.answerSheet.finalizedAt) throw new AppError(409, "AI_EXAMINER_ANSWER_FINALIZED", "Answer sheet has already been finalized");

  await examinationForManager(req, evaluation.answerSheet.examinationId);
  if (evaluation.reviewRounds.length) {
    throw new AppError(409, "AI_EXAMINER_REVIEW_ARTIFACT_LOCKED", "The anonymized review artifact cannot change after a blind review round has been assigned");
  }

  const data = await prisma.$transaction(async tx => {
    const artifact = await tx.aIExaminerReviewArtifact.upsert({
      where: { evaluationId: evaluation.id },
      update: {
        fileName: body.fileName,
        mimeType: body.mimeType,
        fileSize: fileData.length,
        fileData,
        identityMasked: true,
        uploadedById: req.auth!.userId,
      },
      create: {
        organizationId: req.auth!.organizationId,
        evaluationId: evaluation.id,
        fileName: body.fileName,
        mimeType: body.mimeType,
        fileSize: fileData.length,
        fileData,
        identityMasked: true,
        uploadedById: req.auth!.userId,
      },
      select: {
        id: true,
        evaluationId: true,
        mimeType: true,
        fileSize: true,
        identityMasked: true,
        uploadedById: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: req.auth!.organizationId,
        actorId: req.auth!.userId,
        action: evaluation.reviewArtifact ? "AI_EXAMINER_REVIEW_ARTIFACT_REPLACED" : "AI_EXAMINER_REVIEW_ARTIFACT_CREATED",
        entity: "AIExaminerReviewArtifact",
        entityId: artifact.id,
        metadata: {
          evaluationId: evaluation.id,
          mimeType: body.mimeType,
          fileSize: fileData.length,
          identityMaskingConfirmed: true,
        },
      },
    });
    return artifact;
  });
  res.json({ data });
});

router.get("/review-rounds/mine", async (req: AuthRequest, res) => {
  const data = await prisma.aIExaminerReviewRound.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      reviewerId: req.auth!.userId,
      status: { not: AIExaminerReviewRoundStatus.CANCELLED },
    },
    select: {
      id: true,
      evaluationId: true,
      sequence: true,
      kind: true,
      mode: true,
      anonymizeStudentIdentity: true,
      sourceIdentityMasked: true,
      priorMarksVisible: true,
      status: true,
      totalMarks: true,
      submittedAt: true,
      createdAt: true,
      evaluation: {
        select: {
          answerSheet: { select: { id: true, examinationId: true, mimeType: true } },
          reviewArtifact: { select: { id: true, identityMasked: true } },
          _count: { select: { questions: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json({ data });
});

router.get("/evaluations/:evaluationId/review-rounds", async (req: AuthRequest, res) => {
  const evaluationId = cuid.parse(req.params.evaluationId);
  const evaluation = await prisma.aIExaminerEvaluation.findFirst({
    where: { id: evaluationId, organizationId: req.auth!.organizationId },
    include: {
      answerSheet: { select: { examinationId: true } },
      reviewRounds: {
        include: {
          reviewer: { select: { id: true, name: true, role: true } },
          _count: { select: { decisions: true } },
        },
        orderBy: { sequence: "asc" },
      },
    },
  });
  if (!evaluation) throw new AppError(404, "AI_EXAMINER_EVALUATION_NOT_FOUND", "AI evaluation not found");
  await examinationForManager(req, evaluation.answerSheet.examinationId);
  res.json({ data: evaluation.reviewRounds });
});

router.post("/evaluations/:evaluationId/review-rounds", async (req: AuthRequest, res) => {
  const evaluationId = cuid.parse(req.params.evaluationId);
  const body = z.object({
    reviewerId: cuid,
    kind: z.nativeEnum(AIExaminerReviewRoundKind).default(AIExaminerReviewRoundKind.PRIMARY),
  }).parse(req.body);

  const evaluation = await prisma.aIExaminerEvaluation.findFirst({
    where: { id: evaluationId, organizationId: req.auth!.organizationId },
    include: {
      answerSheet: { select: { id: true, examinationId: true, finalizedAt: true } },
      reviewArtifact: { select: { id: true, identityMasked: true } },
      reviewRounds: { select: { sequence: true, reviewerId: true, kind: true, status: true } },
    },
  });
  if (!evaluation) throw new AppError(404, "AI_EXAMINER_EVALUATION_NOT_FOUND", "AI evaluation not found");
  if (evaluation.status !== AIExaminerEvaluationStatus.REVIEW_REQUIRED) {
    throw new AppError(409, "AI_EXAMINER_REVIEW_ROUND_UNAVAILABLE", "Review rounds can only be assigned after AI evaluation is ready for review");
  }
  if (evaluation.answerSheet.finalizedAt) throw new AppError(409, "AI_EXAMINER_ANSWER_FINALIZED", "Answer sheet has already been finalized");

  const exam = await examinationForManager(req, evaluation.answerSheet.examinationId);
  const policy = reviewPolicyFromExamSnapshot(exam.aiExaminerExamProfileSnapshot);
  await assertEligibleReviewRoundReviewer(req, body.reviewerId, exam.branchId);

  const blindReview = policy.mode === "BLIND" || policy.mode === "DOUBLE_BLIND";
  if (blindReview && (!evaluation.reviewArtifact || !evaluation.reviewArtifact.identityMasked)) {
    throw new AppError(422, "AI_EXAMINER_REVIEW_ARTIFACT_REQUIRED", "Upload an identity-masked review artifact before assigning blind or double-blind review");
  }

  if (body.kind === AIExaminerReviewRoundKind.PRIMARY || body.kind === AIExaminerReviewRoundKind.SECONDARY) {
    const duplicateReviewer = evaluation.reviewRounds.some(round =>
      round.reviewerId === body.reviewerId &&
      round.status !== AIExaminerReviewRoundStatus.CANCELLED &&
      (round.kind === AIExaminerReviewRoundKind.PRIMARY || round.kind === AIExaminerReviewRoundKind.SECONDARY)
    );
    if (duplicateReviewer) {
      throw new AppError(409, "AI_EXAMINER_INDEPENDENT_REVIEWER_REQUIRED", "Independent review rounds must use distinct reviewers");
    }
  }

  if (body.kind === AIExaminerReviewRoundKind.MODERATION) {
    const priorIndependentReviewer = evaluation.reviewRounds.some(round =>
      round.reviewerId === body.reviewerId &&
      round.status !== AIExaminerReviewRoundStatus.CANCELLED &&
      (round.kind === AIExaminerReviewRoundKind.PRIMARY || round.kind === AIExaminerReviewRoundKind.SECONDARY)
    );
    if (priorIndependentReviewer) {
      throw new AppError(409, "AI_EXAMINER_MODERATOR_INDEPENDENCE_REQUIRED", "Moderator must be independent from prior primary/secondary reviewers");
    }
  }

  const sequence = Math.max(0, ...evaluation.reviewRounds.map(round => round.sequence)) + 1;
  const data = await prisma.$transaction(async tx => {
    const round = await tx.aIExaminerReviewRound.create({
      data: {
        organizationId: req.auth!.organizationId,
        evaluationId: evaluation.id,
        sequence,
        kind: body.kind,
        mode: policy.mode as AIExaminerReviewMode,
        reviewerId: body.reviewerId,
        assignedById: req.auth!.userId,
        anonymizeStudentIdentity: policy.anonymizeStudentIdentity,
        sourceIdentityMasked: blindReview,
        priorMarksVisible: policy.reviewersSeePriorMarks,
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: req.auth!.organizationId,
        actorId: req.auth!.userId,
        action: "AI_EXAMINER_REVIEW_ROUND_ASSIGNED",
        entity: "AIExaminerReviewRound",
        entityId: round.id,
        metadata: {
          evaluationId: evaluation.id,
          reviewerId: body.reviewerId,
          sequence,
          kind: body.kind,
          mode: policy.mode,
          sourceIdentityMasked: blindReview,
        },
      },
    });
    return round;
  });
  res.status(201).json({ data });
});

router.get("/review-rounds/:roundId/workspace", async (req: AuthRequest, res) => {
  const roundId = cuid.parse(req.params.roundId);
  const round = await prisma.aIExaminerReviewRound.findFirst({
    where: { id: roundId, organizationId: req.auth!.organizationId },
    include: {
      regradeRequest: { select: { id: true, scope: true, questionKeys: true, status: true } },
      evaluation: {
        select: {
          id: true,
          engineVersion: true,
          rubric: {
            select: {
              id: true,
              version: true,
              instructions: true,
              rubric: true,
              modelAnswer: true,
            },
          },
          questions: {
            select: {
              id: true,
              questionKey: true,
              maxMarks: true,
              suggestedMarks: true,
              confidence: true,
              rubricBreakdown: true,
              feedback: true,
              extractedAnswer: true,
              reviewRequired: true,
            },
            orderBy: { createdAt: "asc" },
          },
          answerSheet: {
            select: {
              id: true,
              mimeType: true,
              evidenceAttachments: {
                where: { status: "VERIFIED" },
                select: {
                  id: true, questionKey: true, kind: true, status: true, fileName: true, mimeType: true, fileSize: true,
                  externalUrl: true, durationSeconds: true, transcript: true, observation: true, capturedAt: true, identityMasked: true,
                },
                orderBy: [{ questionKey: "asc" }, { createdAt: "asc" }],
              },
              examination: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                  maximumMarks: true,
                  subject: { select: { id: true, name: true } },
                  questionPaper: { select: { id: true, fileName: true, mimeType: true, publishedAt: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!round) throw new AppError(404, "AI_EXAMINER_REVIEW_ROUND_NOT_FOUND", "Review round not found");
  if (round.reviewerId !== req.auth!.userId) {
    throw new AppError(403, "AI_EXAMINER_REVIEW_ROUND_FORBIDDEN", "Only the assigned reviewer can access this review workspace");
  }
  if (round.status === AIExaminerReviewRoundStatus.CANCELLED) {
    throw new AppError(409, "AI_EXAMINER_REVIEW_ROUND_CLOSED", "Cancelled review rounds cannot access the review workspace");
  }
  if (round.anonymizeStudentIdentity && !round.sourceIdentityMasked) {
    throw new AppError(409, "AI_EXAMINER_SOURCE_IDENTITY_MASK_REQUIRED", "Blind review workspace requires an identity-masked review document");
  }

  const appealKeys = round.kind === AIExaminerReviewRoundKind.APPEAL && round.regradeRequest?.scope === AIExaminerRegradeScope.QUESTION_SET
    ? new Set(round.regradeRequest.questionKeys.map(key => key.toLowerCase()))
    : null;
  const hideAllQuestions = round.kind === AIExaminerReviewRoundKind.APPEAL && round.regradeRequest?.scope === AIExaminerRegradeScope.CLERICAL_CHECK;
  const questions = round.evaluation.questions
    .filter(question => !hideAllQuestions && (!appealKeys || appealKeys.has(question.questionKey.toLowerCase())))
    .map(question => ({
      id: question.id,
      questionKey: question.questionKey,
      maxMarks: question.maxMarks,
      extractedAnswer: question.extractedAnswer,
      reviewRequired: question.reviewRequired,
      ...(round.priorMarksVisible ? {
        aiSuggestedMarks: question.suggestedMarks,
        aiConfidence: question.confidence,
        aiRubricBreakdown: question.rubricBreakdown,
        aiFeedback: question.feedback,
      } : {}),
    }));

  res.json({
    data: {
      round: {
        id: round.id,
        sequence: round.sequence,
        kind: round.kind,
        mode: round.mode,
        status: round.status,
        anonymizeStudentIdentity: round.anonymizeStudentIdentity,
        sourceIdentityMasked: round.sourceIdentityMasked,
        priorMarksVisible: round.priorMarksVisible,
        regrade: round.regradeRequest,
      },
      evaluation: {
        id: round.evaluation.id,
        engineVersion: round.evaluation.engineVersion,
        rubric: round.evaluation.rubric,
        assessment: round.evaluation.answerSheet.examination,
        answerSheet: {
          id: round.evaluation.answerSheet.id,
          mimeType: round.evaluation.answerSheet.mimeType,
          documentRoute: `/api/ai-examiner/review-rounds/${round.id}/document`,
        },
        evidence: round.evaluation.answerSheet.evidenceAttachments.filter(item => !round.anonymizeStudentIdentity || item.identityMasked).map(item => ({
          id: item.id,
          questionKey: item.questionKey,
          kind: item.kind,
          status: item.status,
          durationSeconds: item.durationSeconds,
          transcript: item.transcript,
          observation: item.observation,
          capturedAt: item.capturedAt,
          fileRoute: item.fileName && item.mimeType && item.fileSize
            ? `/api/ai-examiner/review-rounds/${round.id}/evidence/${item.id}/file`
            : null,
          externalUrl: round.anonymizeStudentIdentity ? null : item.externalUrl,
        })),
        questions,
      },
    },
  });
});

router.get("/review-rounds/:roundId/document", async (req: AuthRequest, res) => {
  const roundId = cuid.parse(req.params.roundId);
  const round = await prisma.aIExaminerReviewRound.findFirst({
    where: { id: roundId, organizationId: req.auth!.organizationId },
    include: {
      evaluation: {
        select: {
          id: true,
          reviewArtifact: {
            select: { fileName: true, mimeType: true, fileSize: true, fileData: true, identityMasked: true },
          },
          answerSheet: {
            select: { fileName: true, mimeType: true, fileSize: true, fileData: true },
          },
        },
      },
    },
  });
  if (!round) throw new AppError(404, "AI_EXAMINER_REVIEW_ROUND_NOT_FOUND", "Review round not found");
  if (round.reviewerId !== req.auth!.userId) {
    throw new AppError(403, "AI_EXAMINER_REVIEW_ROUND_FORBIDDEN", "Only the assigned reviewer can access this review document");
  }
  if (round.status === AIExaminerReviewRoundStatus.CANCELLED) {
    throw new AppError(409, "AI_EXAMINER_REVIEW_ROUND_CLOSED", "Cancelled review rounds cannot access assessment documents");
  }

  const source = round.anonymizeStudentIdentity ? round.evaluation.reviewArtifact : round.evaluation.answerSheet;
  if (!source) throw new AppError(409, "AI_EXAMINER_REVIEW_ARTIFACT_REQUIRED", "The required review document is not available");
  if (round.anonymizeStudentIdentity && (!round.sourceIdentityMasked || !("identityMasked" in source) || !source.identityMasked)) {
    throw new AppError(409, "AI_EXAMINER_SOURCE_IDENTITY_MASK_REQUIRED", "Blind review document is not confirmed identity-masked");
  }

  await prisma.auditLog.create({
    data: {
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      action: "AI_EXAMINER_REVIEW_DOCUMENT_ACCESSED",
      entity: "AIExaminerReviewRound",
      entityId: round.id,
      metadata: {
        evaluationId: round.evaluationId,
        anonymized: round.anonymizeStudentIdentity,
      },
    },
  });

  const displayName = round.anonymizeStudentIdentity ? anonymousReviewFileName(source.mimeType) : source.fileName;
  res.set(storedDocumentHeaders({
    fileName: displayName,
    mimeType: source.mimeType,
    fileSize: source.fileSize,
    fallbackName: round.anonymizeStudentIdentity ? "anonymous-answer-sheet" : "answer-sheet",
  }, "inline")).send(storedDocumentBuffer(source.fileData));
});

router.get("/review-rounds/:roundId/evidence/:evidenceId/file", async (req: AuthRequest, res) => {
  const roundId = cuid.parse(req.params.roundId);
  const evidenceId = cuid.parse(req.params.evidenceId);
  const round = await prisma.aIExaminerReviewRound.findFirst({
    where: { id: roundId, organizationId: req.auth!.organizationId },
    select: {
      id: true,
      reviewerId: true,
      status: true,
      anonymizeStudentIdentity: true,
      evaluation: { select: { answerSheetId: true } },
    },
  });
  if (!round) throw new AppError(404, "AI_EXAMINER_REVIEW_ROUND_NOT_FOUND", "Review round not found");
  if (round.reviewerId !== req.auth!.userId) {
    throw new AppError(403, "AI_EXAMINER_REVIEW_ROUND_FORBIDDEN", "Only the assigned reviewer can access supplementary evidence");
  }
  if (round.status === AIExaminerReviewRoundStatus.CANCELLED) {
    throw new AppError(409, "AI_EXAMINER_REVIEW_ROUND_CLOSED", "Cancelled review rounds cannot access supplementary evidence");
  }

  const evidence = await prisma.aIExaminerEvidenceAttachment.findFirst({
    where: {
      id: evidenceId,
      organizationId: req.auth!.organizationId,
      answerSheetId: round.evaluation.answerSheetId,
      status: "VERIFIED",
      ...(round.anonymizeStudentIdentity ? { identityMasked: true } : {}),
    },
    select: {
      id: true,
      answerSheetId: true,
      fileName: true,
      mimeType: true,
      fileSize: true,
      fileData: true,
      identityMasked: true,
      questionKey: true,
    },
  });
  if (!evidence) throw new AppError(404, "AI_EXAMINER_EVIDENCE_NOT_FOUND", "Verified evidence is not available in this review round");
  if (!evidence.fileData || !evidence.fileName || !evidence.mimeType || !evidence.fileSize) {
    throw new AppError(404, "AI_EXAMINER_EVIDENCE_FILE_NOT_FOUND", "This evidence record does not contain an uploaded file");
  }

  await prisma.auditLog.create({
    data: {
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      action: "AI_EXAMINER_REVIEW_EVIDENCE_ACCESSED",
      entity: "AIExaminerEvidenceAttachment",
      entityId: evidence.id,
      metadata: {
        reviewRoundId: round.id,
        answerSheetId: evidence.answerSheetId,
        questionKey: evidence.questionKey,
        anonymized: round.anonymizeStudentIdentity,
      },
    },
  });

  res.set(storedDocumentHeaders({
    fileName: round.anonymizeStudentIdentity ? "anonymous-evidence" : evidence.fileName,
    mimeType: evidence.mimeType,
    fileSize: evidence.fileSize,
    fallbackName: "ai-examiner-evidence",
  }, "inline"));
  res.send(storedDocumentBuffer(evidence.fileData));
});

router.post("/review-rounds/:roundId/submit", async (req: AuthRequest, res) => {
  const roundId = cuid.parse(req.params.roundId);
  const body = z.object({
    decisions: z.array(z.object({
      questionKey: z.string().trim().min(1).max(40),
      awardedMarks: z.coerce.number().min(-10000).max(10000),
      comment: z.string().trim().max(5000).nullable().optional(),
      evidence: z.unknown().optional(),
    })).min(1).max(200),
    notes: z.string().trim().max(5000).nullable().optional(),
  }).parse(req.body);

  const round = await prisma.aIExaminerReviewRound.findFirst({
    where: { id: roundId, organizationId: req.auth!.organizationId },
    include: {
      evaluation: {
        include: {
          questions: true,
          answerSheet: { select: { id: true, examinationId: true, finalizedAt: true } },
        },
      },
    },
  });
  if (!round) throw new AppError(404, "AI_EXAMINER_REVIEW_ROUND_NOT_FOUND", "Review round not found");
  if (round.reviewerId !== req.auth!.userId) throw new AppError(403, "AI_EXAMINER_REVIEW_ROUND_FORBIDDEN", "Only the assigned reviewer can submit this review round");
  if (round.status !== AIExaminerReviewRoundStatus.ASSIGNED && round.status !== AIExaminerReviewRoundStatus.IN_PROGRESS) {
    throw new AppError(409, "AI_EXAMINER_REVIEW_ROUND_CLOSED", "This review round is no longer open for submission");
  }
  if (round.kind === AIExaminerReviewRoundKind.APPEAL) {
    throw new AppError(409, "AI_EXAMINER_APPEAL_USE_REGRADE_REVIEW", "Appeal rounds must be submitted through the scoped regrade-review workflow");
  }
  if (round.evaluation.answerSheet.finalizedAt) throw new AppError(409, "AI_EXAMINER_ANSWER_FINALIZED", "Answer sheet has already been finalized");
  if (round.anonymizeStudentIdentity && !round.sourceIdentityMasked) {
    throw new AppError(409, "AI_EXAMINER_SOURCE_IDENTITY_MASK_REQUIRED", "Blind review cannot be submitted until the source answer sheet is identity-masked");
  }

  const exam = await prisma.examination.findFirst({
    where: { id: round.evaluation.answerSheet.examinationId, organizationId: req.auth!.organizationId },
    select: { id: true, maximumMarks: true, status: true },
  });
  if (!exam) throw new AppError(404, "EXAMINATION_NOT_FOUND", "Examination not found");
  if (exam.status !== ExaminationStatus.COMPLETED) throw new AppError(409, "AI_EXAMINER_EVALUATION_CLOSED", "Examination is no longer open for review");

  const byKey = new Map(body.decisions.map(decision => [decision.questionKey.toLowerCase(), decision]));
  if (byKey.size !== body.decisions.length || byKey.size !== round.evaluation.questions.length) {
    throw new AppError(422, "AI_EXAMINER_REVIEW_INCOMPLETE", "Review round must contain exactly one decision for every evaluated question");
  }

  let total = 0;
  for (const question of round.evaluation.questions) {
    const decision = byKey.get(question.questionKey.toLowerCase());
    if (!decision) throw new AppError(422, "AI_EXAMINER_REVIEW_INCOMPLETE", `Missing review decision for ${question.questionKey}`);
    const maximum = Number(question.maxMarks);
    if (decision.awardedMarks > maximum + 0.001) throw new AppError(422, "AI_EXAMINER_MARKS_EXCEED_MAXIMUM", `Marks for ${question.questionKey} cannot exceed ${maximum}`);
    if (decision.awardedMarks < -maximum - 0.001) throw new AppError(422, "AI_EXAMINER_MARKS_BELOW_MINIMUM", `Marks for ${question.questionKey} cannot be below -${maximum}`);
    total += decision.awardedMarks;
  }
  if (total > exam.maximumMarks + 0.001) throw new AppError(422, "AI_EXAMINER_TOTAL_EXCEEDS_MAXIMUM", "Review-round marks exceed examination maximum marks");

  const now = new Date();
  const submitted = await prisma.$transaction(async tx => {
    await tx.aIExaminerReviewDecision.deleteMany({ where: { reviewRoundId: round.id } });
    for (const question of round.evaluation.questions) {
      const decision = byKey.get(question.questionKey.toLowerCase())!;
      await tx.aIExaminerReviewDecision.create({
        data: {
          organizationId: req.auth!.organizationId,
          reviewRoundId: round.id,
          questionEvaluationId: question.id,
          questionKey: question.questionKey,
          awardedMarks: decision.awardedMarks,
          comment: decision.comment ?? null,
          ...(decision.evidence !== undefined ? { evidence: profileJson(decision.evidence) } : {}),
        },
      });
    }
    const updated = await tx.aIExaminerReviewRound.update({
      where: { id: round.id },
      data: {
        status: AIExaminerReviewRoundStatus.SUBMITTED,
        totalMarks: total,
        notes: body.notes ?? null,
        submittedAt: now,
      },
      include: { decisions: { orderBy: { createdAt: "asc" } } },
    });
    await tx.auditLog.create({
      data: {
        organizationId: req.auth!.organizationId,
        actorId: req.auth!.userId,
        action: "AI_EXAMINER_REVIEW_ROUND_SUBMITTED",
        entity: "AIExaminerReviewRound",
        entityId: round.id,
        metadata: {
          evaluationId: round.evaluationId,
          sequence: round.sequence,
          kind: round.kind,
          totalMarks: total,
          decisionCount: body.decisions.length,
        },
      },
    });
    return updated;
  });
  res.json({ data: submitted });
});

router.get("/examinations/:examinationId/regrade-requests", async (req: AuthRequest, res) => {
  const examinationId = cuid.parse(req.params.examinationId);
  await examinationForManager(req, examinationId);
  const status = z.nativeEnum(AIExaminerRegradeRequestStatus).optional().parse(req.query.status);
  const data = await prisma.aIExaminerRegradeRequest.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      answerSheet: { examinationId },
      ...(status ? { status } : {}),
    },
    include: {
      requestedBy: { select: { id: true, name: true, role: true } },
      decidedBy: { select: { id: true, name: true, role: true } },
      resolvedBy: { select: { id: true, name: true, role: true } },
      reviewRound: {
        select: {
          id: true, sequence: true, kind: true, mode: true, reviewerId: true, status: true,
          totalMarks: true, submittedAt: true,
          reviewer: { select: { id: true, name: true, role: true } },
        },
      },
      result: { select: { id: true, marksObtained: true, percentage: true, grade: true, rank: true, status: true } },
      revision: { select: { id: true, revision: true, createdAt: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json({ data });
});

router.post("/answer-sheets/:answerSheetId/regrade-requests", async (req: AuthRequest, res) => {
  const answerSheetId = cuid.parse(req.params.answerSheetId);
  const body = z.object({
    scope: z.nativeEnum(AIExaminerRegradeScope).default(AIExaminerRegradeScope.WHOLE_SCRIPT),
    questionKeys: z.array(z.string().trim().min(1).max(40)).max(200).optional(),
    reason: z.string().trim().min(10).max(5000),
  }).parse(req.body);

  const { sheet, exam } = await answerSheetForManager(req, answerSheetId);
  if (exam.status !== ExaminationStatus.RESULTS_PUBLISHED) {
    throw new AppError(409, "AI_EXAMINER_REGRADE_RESULTS_NOT_PUBLISHED", "Formal regrade requests are available only after results are published");
  }
  if (!sheet.finalizedAt) {
    throw new AppError(409, "AI_EXAMINER_REGRADE_ANSWER_NOT_FINALIZED", "Only finalized answer sheets can enter regrade");
  }

  const policy = regradePolicyFromExamSnapshot(exam.aiExaminerExamProfileSnapshot);
  if (!policy.enabled) throw new AppError(409, "AI_EXAMINER_REGRADE_DISABLED", "Regrade is disabled by the assigned exam profile");

  const publishedAt = await publicationAuditTime(req.auth!.organizationId, exam.id);
  const window = aiExaminerRegradeWindow({ publishedAt, requestWindowDays: policy.requestWindowDays });
  if (!window.open) throw new AppError(409, window.reason ?? "AI_EXAMINER_REGRADE_WINDOW_CLOSED", "The configured regrade request window is closed");

  const [evaluation, result, priorRequests, openRequest] = await Promise.all([
    prisma.aIExaminerEvaluation.findFirst({
      where: {
        organizationId: req.auth!.organizationId,
        answerSheetId,
        status: AIExaminerEvaluationStatus.APPROVED,
      },
      include: { questions: { select: { questionKey: true, finalMarks: true, maxMarks: true } } },
      orderBy: { revision: "desc" },
    }),
    prisma.examinationResult.findFirst({
      where: {
        organizationId: req.auth!.organizationId,
        examinationId: exam.id,
        studentId: sheet.studentId,
      },
    }),
    prisma.aIExaminerRegradeRequest.count({
      where: {
        organizationId: req.auth!.organizationId,
        answerSheetId,
        status: { not: AIExaminerRegradeRequestStatus.CANCELLED },
      },
    }),
    prisma.aIExaminerRegradeRequest.findFirst({
      where: {
        organizationId: req.auth!.organizationId,
        answerSheetId,
        status: { in: [
          AIExaminerRegradeRequestStatus.REQUESTED,
          AIExaminerRegradeRequestStatus.APPROVED,
          AIExaminerRegradeRequestStatus.REVIEW_IN_PROGRESS,
        ] },
      },
      select: { id: true, status: true },
    }),
  ]);

  if (!evaluation) throw new AppError(409, "AI_EXAMINER_REGRADE_EVALUATION_REQUIRED", "An approved AI Examiner evaluation is required for formal regrade");
  if (!result || result.marksObtained == null || !result.generatedAt) {
    throw new AppError(409, "AI_EXAMINER_REGRADE_RESULT_REQUIRED", "A generated published result with marks is required for regrade");
  }
  if (openRequest) throw new AppError(409, "AI_EXAMINER_REGRADE_ALREADY_OPEN", "An open regrade request already exists for this answer sheet");
  if (priorRequests >= policy.maxRequestsPerAnswerSheet) {
    throw new AppError(409, "AI_EXAMINER_REGRADE_LIMIT_REACHED", "The configured maximum number of regrade requests has been reached");
  }

  let questionKeys: string[];
  try {
    questionKeys = normalizeAIExaminerRegradeQuestionKeys({
      scope: body.scope,
      questionKeys: body.questionKeys,
      availableQuestionKeys: evaluation.questions.map(question => question.questionKey),
    });
  } catch (error) {
    throw new AppError(422, "AI_EXAMINER_REGRADE_SCOPE_INVALID", error instanceof Error ? error.message : "Invalid regrade question scope");
  }

  const data = await prisma.$transaction(async tx => {
    const request = await tx.aIExaminerRegradeRequest.create({
      data: {
        organizationId: req.auth!.organizationId,
        answerSheetId,
        evaluationId: evaluation.id,
        resultId: result.id,
        scope: body.scope,
        questionKeys,
        reason: body.reason,
        originalMarks: Number(result.marksObtained),
        requestedById: req.auth!.userId,
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: req.auth!.organizationId,
        actorId: req.auth!.userId,
        action: "AI_EXAMINER_REGRADE_REQUESTED",
        entity: "AIExaminerRegradeRequest",
        entityId: request.id,
        metadata: {
          answerSheetId,
          examinationId: exam.id,
          evaluationId: evaluation.id,
          resultId: result.id,
          scope: body.scope,
          questionKeys,
          originalMarks: Number(result.marksObtained),
          closesAt: window.closesAt?.toISOString() ?? null,
        },
      },
    });
    return request;
  });
  res.status(201).json({ data, meta: { closesAt: window.closesAt } });
});

router.post("/regrade-requests/:requestId/decision", async (req: AuthRequest, res) => {
  requireRegradeAdmin(req);
  const requestId = cuid.parse(req.params.requestId);
  const body = z.object({
    decision: z.enum(["APPROVE", "REJECT"]),
    notes: z.string().trim().min(3).max(5000),
  }).parse(req.body);

  const request = await prisma.aIExaminerRegradeRequest.findFirst({
    where: { id: requestId, organizationId: req.auth!.organizationId },
    include: { answerSheet: { select: { examinationId: true } } },
  });
  if (!request) throw new AppError(404, "AI_EXAMINER_REGRADE_NOT_FOUND", "Regrade request not found");
  const exam = await examinationForManager(req, request.answerSheet.examinationId);
  if (exam.status !== ExaminationStatus.RESULTS_PUBLISHED) {
    throw new AppError(409, "AI_EXAMINER_REGRADE_RESULTS_NOT_PUBLISHED", "Regrade decisions require published results");
  }
  if (request.status !== AIExaminerRegradeRequestStatus.REQUESTED) {
    throw new AppError(409, "AI_EXAMINER_REGRADE_DECISION_CLOSED", "This regrade request has already been decided");
  }

  const nextStatus = body.decision === "APPROVE"
    ? AIExaminerRegradeRequestStatus.APPROVED
    : AIExaminerRegradeRequestStatus.REJECTED;
  const now = new Date();
  const data = await prisma.$transaction(async tx => {
    const changed = await tx.aIExaminerRegradeRequest.updateMany({
      where: { id: request.id, organizationId: req.auth!.organizationId, status: AIExaminerRegradeRequestStatus.REQUESTED },
      data: {
        status: nextStatus,
        decidedById: req.auth!.userId,
        decisionNotes: body.notes,
        decidedAt: now,
      },
    });
    if (changed.count !== 1) throw new AppError(409, "AI_EXAMINER_REGRADE_CHANGED", "Regrade request changed concurrently; refresh and retry");
    await tx.auditLog.create({
      data: {
        organizationId: req.auth!.organizationId,
        actorId: req.auth!.userId,
        action: body.decision === "APPROVE" ? "AI_EXAMINER_REGRADE_APPROVED" : "AI_EXAMINER_REGRADE_REJECTED",
        entity: "AIExaminerRegradeRequest",
        entityId: request.id,
        metadata: { examinationId: exam.id, notes: body.notes },
      },
    });
    return tx.aIExaminerRegradeRequest.findUniqueOrThrow({ where: { id: request.id } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  res.json({ data });
});

router.post("/regrade-requests/:requestId/assign", async (req: AuthRequest, res) => {
  requireRegradeAdmin(req);
  const requestId = cuid.parse(req.params.requestId);
  const body = z.object({ reviewerId: cuid }).parse(req.body);

  const request = await prisma.aIExaminerRegradeRequest.findFirst({
    where: { id: requestId, organizationId: req.auth!.organizationId },
    include: {
      answerSheet: { select: { examinationId: true, evaluatedById: true } },
      evaluation: {
        select: {
          reviewedById: true,
          reviewArtifact: { select: { id: true, identityMasked: true } },
          reviewRounds: { select: { sequence: true, reviewerId: true, kind: true, status: true } },
        },
      },
    },
  });
  if (!request) throw new AppError(404, "AI_EXAMINER_REGRADE_NOT_FOUND", "Regrade request not found");
  if (request.status !== AIExaminerRegradeRequestStatus.APPROVED) {
    throw new AppError(409, "AI_EXAMINER_REGRADE_ASSIGNMENT_UNAVAILABLE", "Only an approved regrade request can be assigned");
  }

  const exam = await examinationForManager(req, request.answerSheet.examinationId);
  if (exam.status !== ExaminationStatus.RESULTS_PUBLISHED) {
    throw new AppError(409, "AI_EXAMINER_REGRADE_RESULTS_NOT_PUBLISHED", "Regrade review requires published results");
  }
  const regradePolicy = regradePolicyFromExamSnapshot(exam.aiExaminerExamProfileSnapshot);
  const reviewPolicy = reviewPolicyFromExamSnapshot(exam.aiExaminerExamProfileSnapshot);
  await assertEligibleReviewRoundReviewer(req, body.reviewerId, exam.branchId);

  if (regradePolicy.requireIndependentReviewer) {
    const conflicted = new Set([
      request.requestedById,
      request.decidedById,
      request.answerSheet.evaluatedById,
      request.evaluation.reviewedById,
    ].filter((value): value is string => Boolean(value)));
    if (conflicted.has(body.reviewerId) || request.evaluation.reviewRounds.some(round =>
      round.reviewerId === body.reviewerId && round.status !== AIExaminerReviewRoundStatus.CANCELLED
    )) {
      throw new AppError(409, "AI_EXAMINER_REGRADE_INDEPENDENT_REVIEWER_REQUIRED", "Regrade reviewer must be independent from the requester, decision-maker and prior reviewers");
    }
  }

  const anonymize = reviewPolicy.anonymizeStudentIdentity;
  if (anonymize && (!request.evaluation.reviewArtifact || !request.evaluation.reviewArtifact.identityMasked)) {
    throw new AppError(422, "AI_EXAMINER_REVIEW_ARTIFACT_REQUIRED", "An identity-masked review artifact is required before assigning this regrade");
  }

  const sequence = Math.max(0, ...request.evaluation.reviewRounds.map(round => round.sequence)) + 1;
  const data = await prisma.$transaction(async tx => {
    const changed = await tx.aIExaminerRegradeRequest.updateMany({
      where: { id: request.id, organizationId: req.auth!.organizationId, status: AIExaminerRegradeRequestStatus.APPROVED, reviewRoundId: null },
      data: { status: AIExaminerRegradeRequestStatus.REVIEW_IN_PROGRESS },
    });
    if (changed.count !== 1) throw new AppError(409, "AI_EXAMINER_REGRADE_CHANGED", "Regrade assignment changed concurrently; refresh and retry");

    const round = await tx.aIExaminerReviewRound.create({
      data: {
        organizationId: req.auth!.organizationId,
        evaluationId: request.evaluationId,
        sequence,
        kind: AIExaminerReviewRoundKind.APPEAL,
        mode: reviewPolicy.mode as AIExaminerReviewMode,
        reviewerId: body.reviewerId,
        assignedById: req.auth!.userId,
        anonymizeStudentIdentity: anonymize,
        sourceIdentityMasked: anonymize,
        priorMarksVisible: false,
      },
    });
    await tx.aIExaminerRegradeRequest.update({
      where: { id: request.id },
      data: { reviewRoundId: round.id },
    });
    await tx.auditLog.create({
      data: {
        organizationId: req.auth!.organizationId,
        actorId: req.auth!.userId,
        action: "AI_EXAMINER_REGRADE_REVIEW_ASSIGNED",
        entity: "AIExaminerRegradeRequest",
        entityId: request.id,
        metadata: {
          examinationId: exam.id,
          reviewerId: body.reviewerId,
          reviewRoundId: round.id,
          scope: request.scope,
          independentReviewerRequired: regradePolicy.requireIndependentReviewer,
        },
      },
    });
    return round;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  res.status(201).json({ data });
});

router.post("/regrade-requests/:requestId/review", async (req: AuthRequest, res) => {
  const requestId = cuid.parse(req.params.requestId);
  const body = z.object({
    decisions: z.array(z.object({
      questionKey: z.string().trim().min(1).max(40),
      awardedMarks: z.coerce.number().min(-10000).max(10000),
      comment: z.string().trim().max(5000).nullable().optional(),
      evidence: z.unknown().optional(),
    })).max(200).default([]),
    correctedTotalMarks: z.coerce.number().min(-10000).max(10000).optional(),
    notes: z.string().trim().min(3).max(5000),
  }).parse(req.body);

  const request = await prisma.aIExaminerRegradeRequest.findFirst({
    where: { id: requestId, organizationId: req.auth!.organizationId },
    include: {
      answerSheet: { select: { examinationId: true } },
      evaluation: { include: { questions: { orderBy: { createdAt: "asc" } } } },
      reviewRound: true,
    },
  });
  if (!request) throw new AppError(404, "AI_EXAMINER_REGRADE_NOT_FOUND", "Regrade request not found");
  if (request.status !== AIExaminerRegradeRequestStatus.REVIEW_IN_PROGRESS || !request.reviewRound) {
    throw new AppError(409, "AI_EXAMINER_REGRADE_REVIEW_UNAVAILABLE", "This regrade request is not awaiting an assigned review");
  }
  if (request.reviewRound.reviewerId !== req.auth!.userId) {
    throw new AppError(403, "AI_EXAMINER_REGRADE_REVIEW_FORBIDDEN", "Only the assigned independent reviewer can submit this regrade review");
  }
  if (request.reviewRound.status !== AIExaminerReviewRoundStatus.ASSIGNED && request.reviewRound.status !== AIExaminerReviewRoundStatus.IN_PROGRESS) {
    throw new AppError(409, "AI_EXAMINER_REGRADE_REVIEW_CLOSED", "This regrade review round is already closed");
  }

  const exam = await prisma.examination.findFirst({
    where: { id: request.answerSheet.examinationId, organizationId: req.auth!.organizationId },
    select: { id: true, maximumMarks: true, status: true },
  });
  if (!exam) throw new AppError(404, "EXAMINATION_NOT_FOUND", "Examination not found");
  if (exam.status !== ExaminationStatus.RESULTS_PUBLISHED) {
    throw new AppError(409, "AI_EXAMINER_REGRADE_RESULTS_NOT_PUBLISHED", "Regrade review requires published results");
  }

  let revisedTotal = 0;
  const expectedKeys = request.scope === AIExaminerRegradeScope.WHOLE_SCRIPT
    ? request.evaluation.questions.map(question => question.questionKey)
    : request.scope === AIExaminerRegradeScope.QUESTION_SET
      ? request.questionKeys
      : [];
  const expected = new Set(expectedKeys.map(key => key.toLowerCase()));
  const byKey = new Map(body.decisions.map(decision => [decision.questionKey.toLowerCase(), decision]));
  if (byKey.size !== body.decisions.length) {
    throw new AppError(422, "AI_EXAMINER_REGRADE_DUPLICATE_QUESTION", "Regrade review contains duplicate question decisions");
  }

  if (request.scope === AIExaminerRegradeScope.CLERICAL_CHECK) {
    if (body.decisions.length) throw new AppError(422, "AI_EXAMINER_REGRADE_SCOPE_INVALID", "Clerical checks accept a corrected total, not question-level decisions");
    if (body.correctedTotalMarks == null) throw new AppError(422, "AI_EXAMINER_REGRADE_TOTAL_REQUIRED", "Clerical check requires correctedTotalMarks");
    revisedTotal = body.correctedTotalMarks;
  } else {
    if (body.correctedTotalMarks != null) throw new AppError(422, "AI_EXAMINER_REGRADE_SCOPE_INVALID", "Question review derives the revised total from question-level decisions");
    if (byKey.size !== expected.size || [...byKey.keys()].some(key => !expected.has(key))) {
      throw new AppError(422, "AI_EXAMINER_REGRADE_REVIEW_INCOMPLETE", "Regrade review must contain exactly the configured question scope");
    }

    for (const question of request.evaluation.questions) {
      const decision = byKey.get(question.questionKey.toLowerCase());
      const existing = question.finalMarks == null ? null : Number(question.finalMarks);
      if (expected.has(question.questionKey.toLowerCase())) {
        if (!decision) throw new AppError(422, "AI_EXAMINER_REGRADE_REVIEW_INCOMPLETE", `Missing regrade decision for ${question.questionKey}`);
        const maximum = Number(question.maxMarks);
        if (decision.awardedMarks > maximum + 0.001 || decision.awardedMarks < -maximum - 0.001) {
          throw new AppError(422, "AI_EXAMINER_REGRADE_MARKS_OUT_OF_RANGE", `Regrade marks for ${question.questionKey} must remain within the question mark range`);
        }
        revisedTotal += decision.awardedMarks;
      } else {
        if (existing == null) throw new AppError(409, "AI_EXAMINER_REGRADE_BASE_MARKS_MISSING", `Existing final marks are unavailable for ${question.questionKey}`);
        revisedTotal += existing;
      }
    }
  }

  if (revisedTotal > exam.maximumMarks + 0.001 || revisedTotal < -exam.maximumMarks - 0.001) {
    throw new AppError(422, "AI_EXAMINER_REGRADE_TOTAL_OUT_OF_RANGE", "Regrade total is outside the examination mark range");
  }

  const now = new Date();
  const data = await prisma.$transaction(async tx => {
    await tx.aIExaminerReviewDecision.deleteMany({ where: { reviewRoundId: request.reviewRound!.id } });
    for (const question of request.evaluation.questions) {
      const decision = byKey.get(question.questionKey.toLowerCase());
      if (!decision) continue;
      await tx.aIExaminerReviewDecision.create({
        data: {
          organizationId: req.auth!.organizationId,
          reviewRoundId: request.reviewRound!.id,
          questionEvaluationId: question.id,
          questionKey: question.questionKey,
          awardedMarks: decision.awardedMarks,
          comment: decision.comment ?? null,
          ...(decision.evidence !== undefined ? { evidence: profileJson(decision.evidence) } : {}),
        },
      });
    }
    const changed = await tx.aIExaminerReviewRound.updateMany({
      where: {
        id: request.reviewRound!.id,
        organizationId: req.auth!.organizationId,
        reviewerId: req.auth!.userId,
        status: { in: [AIExaminerReviewRoundStatus.ASSIGNED, AIExaminerReviewRoundStatus.IN_PROGRESS] },
      },
      data: {
        status: AIExaminerReviewRoundStatus.SUBMITTED,
        totalMarks: revisedTotal,
        notes: body.notes,
        submittedAt: now,
      },
    });
    if (changed.count !== 1) throw new AppError(409, "AI_EXAMINER_REGRADE_REVIEW_CHANGED", "Regrade review changed concurrently; refresh and retry");
    await tx.auditLog.create({
      data: {
        organizationId: req.auth!.organizationId,
        actorId: req.auth!.userId,
        action: "AI_EXAMINER_REGRADE_REVIEW_SUBMITTED",
        entity: "AIExaminerRegradeRequest",
        entityId: request.id,
        metadata: {
          reviewRoundId: request.reviewRound!.id,
          scope: request.scope,
          questionKeys: expectedKeys,
          revisedTotal,
        },
      },
    });
    return tx.aIExaminerReviewRound.findUniqueOrThrow({
      where: { id: request.reviewRound!.id },
      include: { decisions: { orderBy: { createdAt: "asc" } } },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  res.json({ data, meta: { revisedTotal } });
});

router.post("/regrade-requests/:requestId/resolve", async (req: AuthRequest, res) => {
  requireRegradeAdmin(req);
  const requestId = cuid.parse(req.params.requestId);
  const body = z.object({
    correctedMarks: z.coerce.number().min(-10000).max(10000).optional(),
    notes: z.string().trim().min(3).max(5000),
  }).parse(req.body);

  const request = await prisma.aIExaminerRegradeRequest.findFirst({
    where: { id: requestId, organizationId: req.auth!.organizationId },
    include: {
      answerSheet: { select: { id: true, examinationId: true, studentId: true } },
      evaluation: {
        select: {
          id: true,
          questions: {
            select: { id: true, questionKey: true, finalMarks: true, teacherComment: true, maxMarks: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
      result: true,
      reviewRound: {
        include: {
          decisions: {
            select: { questionKey: true, awardedMarks: true, comment: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });
  if (!request) throw new AppError(404, "AI_EXAMINER_REGRADE_NOT_FOUND", "Regrade request not found");
  const exam = await examinationForManager(req, request.answerSheet.examinationId);
  if (exam.status !== ExaminationStatus.RESULTS_PUBLISHED) {
    throw new AppError(409, "AI_EXAMINER_REGRADE_RESULTS_NOT_PUBLISHED", "Regrade resolution requires published results");
  }
  const policy = regradePolicyFromExamSnapshot(exam.aiExaminerExamProfileSnapshot);

  let resolvedMarks: number;
  if (request.reviewRound) {
    if (request.status !== AIExaminerRegradeRequestStatus.REVIEW_IN_PROGRESS || request.reviewRound.status !== AIExaminerReviewRoundStatus.SUBMITTED || request.reviewRound.totalMarks == null) {
      throw new AppError(409, "AI_EXAMINER_REGRADE_REVIEW_INCOMPLETE", "Assigned regrade review must be submitted before resolution");
    }
    if (policy.requireIndependentReviewer && request.reviewRound.reviewerId === req.auth!.userId) {
      throw new AppError(409, "AI_EXAMINER_REGRADE_RESOLVER_INDEPENDENCE_REQUIRED", "The independent reviewer cannot also finalize the result revision");
    }
    resolvedMarks = Number(request.reviewRound.totalMarks);
    if (body.correctedMarks != null && Math.abs(body.correctedMarks - resolvedMarks) > 0.001) {
      throw new AppError(422, "AI_EXAMINER_REGRADE_RESOLUTION_MISMATCH", "Resolution marks must match the submitted independent review");
    }
  } else {
    if (request.scope !== AIExaminerRegradeScope.CLERICAL_CHECK || policy.requireIndependentReviewer) {
      throw new AppError(409, "AI_EXAMINER_REGRADE_REVIEW_REQUIRED", "This regrade policy requires an assigned review before resolution");
    }
    if (request.status !== AIExaminerRegradeRequestStatus.APPROVED || body.correctedMarks == null) {
      throw new AppError(422, "AI_EXAMINER_REGRADE_TOTAL_REQUIRED", "Approved clerical regrade requires correctedMarks");
    }
    resolvedMarks = body.correctedMarks;
  }

  if (resolvedMarks > exam.maximumMarks + 0.001 || resolvedMarks < -exam.maximumMarks - 0.001) {
    throw new AppError(422, "AI_EXAMINER_REGRADE_TOTAL_OUT_OF_RANGE", "Resolved marks are outside the examination mark range");
  }

  const now = new Date();
  const data = await prisma.$transaction(async tx => {
    const changed = await tx.aIExaminerRegradeRequest.updateMany({
      where: {
        id: request.id,
        organizationId: req.auth!.organizationId,
        status: request.status,
        resolvedAt: null,
      },
      data: { updatedAt: now },
    });
    if (changed.count !== 1) throw new AppError(409, "AI_EXAMINER_REGRADE_CHANGED", "Regrade request changed concurrently; refresh and retry");

    const currentResult = await tx.examinationResult.findFirst({
      where: {
        id: request.resultId,
        organizationId: req.auth!.organizationId,
        examinationId: exam.id,
        studentId: request.answerSheet.studentId,
      },
    });
    if (!currentResult || currentResult.marksObtained == null) {
      throw new AppError(409, "AI_EXAMINER_REGRADE_RESULT_REQUIRED", "Published result is unavailable for revision");
    }
    const beforeSnapshot = {
      result: resultRevisionSnapshot(currentResult),
      questions: request.evaluation.questions.map(question => ({
        questionKey: question.questionKey,
        finalMarks: question.finalMarks == null ? null : Number(question.finalMarks),
        teacherComment: question.teacherComment,
      })),
    };
    const recalculated = examinationResultFor(resolvedMarks, exam.maximumMarks, exam.passingMarks, currentResult.generatedAt ?? now);

    await tx.examinationResult.update({
      where: { id: currentResult.id },
      data: {
        marksObtained: recalculated.marksObtained,
        percentage: recalculated.percentage,
        grade: recalculated.grade,
        gpa: recalculated.gpa,
        status: recalculated.status,
        generatedAt: currentResult.generatedAt ?? now,
      },
    });
    await tx.examinationAnswerSheet.update({
      where: { id: request.answerSheet.id },
      data: { marksObtained: resolvedMarks },
    });

    if (request.scope !== AIExaminerRegradeScope.CLERICAL_CHECK && request.reviewRound) {
      const decisions = new Map(request.reviewRound.decisions.map(decision => [decision.questionKey.toLowerCase(), decision]));
      for (const question of request.evaluation.questions) {
        const decision = decisions.get(question.questionKey.toLowerCase());
        if (!decision) continue;
        await tx.aIExaminerQuestionEvaluation.update({
          where: { id: question.id },
          data: {
            finalMarks: Number(decision.awardedMarks),
            teacherComment: decision.comment ?? question.teacherComment,
            reviewRequired: false,
          },
        });
      }
    }

    const rankImpacts = await recomputePublishedRanks(tx, req.auth!.organizationId, exam.id);

    const [updatedResult, updatedQuestions] = await Promise.all([
      tx.examinationResult.findUniqueOrThrow({ where: { id: currentResult.id } }),
      tx.aIExaminerQuestionEvaluation.findMany({
        where: { evaluationId: request.evaluation.id },
        select: { questionKey: true, finalMarks: true, teacherComment: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    const afterSnapshot = {
      result: resultRevisionSnapshot(updatedResult),
      questions: updatedQuestions.map(question => ({
        questionKey: question.questionKey,
        finalMarks: question.finalMarks == null ? null : Number(question.finalMarks),
        teacherComment: question.teacherComment,
      })),
    };
    const latestRevision = await tx.aIExaminerResultRevision.findFirst({
      where: { organizationId: req.auth!.organizationId, resultId: currentResult.id },
      select: { revision: true },
      orderBy: { revision: "desc" },
    });
    const revision = (latestRevision?.revision ?? 0) + 1;

    const revisionRow = await tx.aIExaminerResultRevision.create({
      data: {
        organizationId: req.auth!.organizationId,
        resultId: currentResult.id,
        regradeRequestId: request.id,
        revision,
        beforeSnapshot: profileJson(beforeSnapshot),
        afterSnapshot: profileJson(afterSnapshot),
        changedById: req.auth!.userId,
      },
    });
    await tx.aIExaminerRegradeRequest.update({
      where: { id: request.id },
      data: {
        status: AIExaminerRegradeRequestStatus.RESOLVED,
        resolvedMarks,
        resolvedById: req.auth!.userId,
        resolutionNotes: body.notes,
        resolvedAt: now,
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: req.auth!.organizationId,
        actorId: req.auth!.userId,
        action: "AI_EXAMINER_REGRADE_RESOLVED",
        entity: "AIExaminerRegradeRequest",
        entityId: request.id,
        metadata: {
          examinationId: exam.id,
          resultId: currentResult.id,
          resultRevisionId: revisionRow.id,
          revision,
          originalMarks: Number(request.originalMarks),
          beforeMarks: Number(currentResult.marksObtained),
          resolvedMarks,
          scope: request.scope,
          rankImpacts,
          revisedQuestionKeys: request.scope === AIExaminerRegradeScope.CLERICAL_CHECK
            ? []
            : request.reviewRound?.decisions.map(decision => decision.questionKey) ?? [],
        },
      },
    });

    return {
      request: await tx.aIExaminerRegradeRequest.findUniqueOrThrow({ where: { id: request.id } }),
      result: updatedResult,
      revision: revisionRow,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  res.json({ data });
});

router.get("/results/:resultId/revisions", async (req: AuthRequest, res) => {
  const resultId = cuid.parse(req.params.resultId);
  const result = await prisma.examinationResult.findFirst({
    where: { id: resultId, organizationId: req.auth!.organizationId },
    select: { id: true, examinationId: true },
  });
  if (!result) throw new AppError(404, "EXAMINATION_RESULT_NOT_FOUND", "Examination result not found");
  await examinationForManager(req, result.examinationId);
  const data = await prisma.aIExaminerResultRevision.findMany({
    where: { organizationId: req.auth!.organizationId, resultId },
    include: {
      changedBy: { select: { id: true, name: true, role: true } },
      regradeRequest: {
        select: { id: true, scope: true, questionKeys: true, reason: true, resolutionNotes: true, resolvedAt: true },
      },
    },
    orderBy: { revision: "desc" },
  });
  res.json({ data });
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
      reviewRounds: { select: { reviewerId: true, kind: true, status: true, totalMarks: true } },
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

  const reviewPolicy = reviewPolicyFromExamSnapshot(exam.aiExaminerExamProfileSnapshot);
  const reviewCompletion = assessAIExaminerReviewCompletion({
    policy: reviewPolicy,
    rounds: evaluation.reviewRounds.map(round => ({
      reviewerId: round.reviewerId,
      kind: round.kind,
      status: round.status,
      totalMarks: round.totalMarks == null ? null : Number(round.totalMarks),
    })),
    maximumMarks: exam.maximumMarks,
  });
  if (!reviewCompletion.readyToFinalize) {
    throw new AppError(409, "AI_EXAMINER_REVIEW_POLICY_INCOMPLETE", reviewCompletion.blockers.join(" "));
  }

  const activeRubric = exam.aiExaminerRubrics.find(rubric => rubric.status === AIExaminerRubricStatus.ACTIVE);
  if (!activeRubric) throw new AppError(409, "AI_EXAMINER_ACTIVE_RUBRIC_REQUIRED", "Active rubric is required before final approval");
  const resolvedRubricQuestions = resolveAIExaminerRubricQuestions(activeRubric.rubric, activeRubric.modelAnswer);
  const supplementaryQuestions = resolvedRubricQuestions
    .filter(question => question.questionType === "ORAL_AUDIO_VIDEO" || question.questionType === "PRACTICAL_PROJECT_VIVA");
  if (supplementaryQuestions.length) {
    const verifiedEvidence = await prisma.aIExaminerEvidenceAttachment.findMany({
      where: {
        organizationId: req.auth!.organizationId,
        answerSheetId: evaluation.answerSheet.id,
        status: "VERIFIED",
        questionKey: { in: supplementaryQuestions.map(question => question.key) },
      },
      select: { questionKey: true },
    });
    const verifiedKeys = new Set(verifiedEvidence.map(item => item.questionKey.toLocaleLowerCase("en")));
    const missing = supplementaryQuestions.filter(question => !verifiedKeys.has(question.key.toLocaleLowerCase("en"))).map(question => question.key);
    if (missing.length) {
      throw new AppError(
        409,
        "AI_EXAMINER_SUPPLEMENTARY_EVIDENCE_INCOMPLETE",
        `Verified oral/practical evidence is required before final approval for: ${missing.join(", ")}`,
      );
    }
  }

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

    const student = await tx.studentProfile.findFirst({
      where: { id: evaluation.answerSheet.studentId, organizationId: req.auth!.organizationId },
      select: { userId: true },
    });
    if (!student) throw new AppError(409, "AI_EXAMINER_STUDENT_NOT_FOUND", "Student profile is unavailable for remediation linkage");
    const rubricByKey = new Map(resolvedRubricQuestions.map(question => [question.key.toLocaleLowerCase("en"), question]));
    const weakQuestions = evaluation.questions.flatMap(question => {
      const reviewed = byKey.get(question.questionKey.toLowerCase())!;
      const rubricQuestion = rubricByKey.get(question.questionKey.toLocaleLowerCase("en"));
      const maximum = Number(question.maxMarks);
      const ratio = maximum > 0 ? reviewed.finalMarks / maximum : 1;
      if (ratio >= 0.6) return [];
      const concepts = rubricQuestion?.concepts ?? [];
      const conceptLabel = concepts.length ? concepts.slice(0, 4).join(", ") : question.questionKey;
      return [{
        organizationId: req.auth!.organizationId,
        userId: student.userId,
        kind: "AI_EXAMINER_REMEDIATION",
        title: `Revise ${exam.subject.name}: ${conceptLabel}`.slice(0, 180),
        reason: `Teacher-approved score ${reviewed.finalMarks}/${maximum} on ${question.questionKey}. Review the underlying concepts before the next assessment.`,
        entityType: "AI_EXAMINER_QUESTION",
        entityId: `${evaluation.id}:${question.questionKey}`,
        priority: ratio < 0.3 ? 90 : ratio < 0.5 ? 75 : 60,
      }];
    });
    if (weakQuestions.length) {
      await tx.learningRecommendation.createMany({ data: weakQuestions });
    }
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
          remediationRecommendations: evaluation.questions.filter(question => {
            const reviewed = byKey.get(question.questionKey.toLowerCase())!;
            return Number(question.maxMarks) > 0 && reviewed.finalMarks / Number(question.maxMarks) < 0.6;
          }).length,
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
