import { AcademicBoard, AIExaminerBenchmarkRunStatus, AIExaminerBenchmarkSuiteStatus, AIExaminerEvaluationStatus, AIExaminerExamProfileStatus, AIExaminerReviewMode, AIExaminerReviewRoundKind, AIExaminerReviewRoundStatus, AIExaminerRubricStatus, AIExaminerScanBindingStatus, AIExaminerScanPageStatus, AnswerSheetStatus, ClassLevel, ExaminationStatus, Prisma, QuestionType, Role } from "@prisma/client";
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
import { assertExaminationManager, evaluationStatus, examinationResultFor } from "../lib/examination-policy.js";
import { AppError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { storedDocumentBuffer, storedDocumentHeaders } from "../lib/secure-download.js";
import { allowedAnswerSheetTypes, assertDocumentFileExtension, decodeVerifiedUpload } from "../lib/secure-upload.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";
import { requireCommercialFeature } from "../middleware/commercial-entitlement.js";

const router = Router();
router.use(requireAuth, allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN, Role.TEACHER), requireCommercialFeature("examinations"));

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
  drift: z.object({
    maximumNormalizedMaeIncrease: z.coerce.number().min(0).max(1),
    maximumOverrideRateIncrease: z.coerce.number().min(0).max(1),
    maximumLowConfidenceRateIncrease: z.coerce.number().min(0).max(1),
    maximumWithinToleranceRateDrop: z.coerce.number().min(0).max(1),
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
    humanReviewerId: cuid,
    goldNotes: z.string().trim().max(10000).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).superRefine((value, ctx) => {
    if (value.minimumMarks > value.maxMarks) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["minimumMarks"], message: "Minimum marks cannot exceed maximum marks" });
    if (value.humanMarks < value.minimumMarks || value.humanMarks > value.maxMarks) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["humanMarks"], message: "Human marks must be within configured question bounds" });
  }).parse(req.body);

  const reviewer = await prisma.user.findFirst({
    where: { id: body.humanReviewerId, organizationId: req.auth!.organizationId, isActive: true },
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

  const questions = round.evaluation.questions.map(question => ({
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
