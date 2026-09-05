import { AnswerSheetStatus, ExaminationStatus, Prisma, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/http.js";
import {
  answerSubmissionState,
  assertAnswerSheetReplaceable,
  assertEvaluationOpen,
  assertExaminationManager,
  assertQuestionPaperAvailable,
  assertSingleConditionalMutation,
  assertStudentExaminationEligible,
  evaluationStatus,
  examinationResultFor,
  publishedEvaluation,
  replaceableAnswerSheetStatuses,
} from "../lib/examination-policy.js";
import { prisma } from "../lib/prisma.js";
import { loadAuthorizedDocument, storedDocumentBuffer, storedDocumentHeaders } from "../lib/secure-download.js";
import { allowedAnswerSheetTypes, allowedDocumentTypes, assertDocumentFileExtension, decodeVerifiedUpload, type AllowedDocumentType } from "../lib/secure-upload.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);
const id = z.string().cuid();
const uploadFields = { fileName: z.string().trim().min(1).max(180), base64: z.string().min(1), remarks: z.string().trim().max(2000).optional() } as const;
const questionPaperUpload = z.object({ ...uploadFields, mimeType: z.enum(allowedDocumentTypes) });
const answerSheetUpload = z.object({ ...uploadFields, mimeType: z.enum(allowedAnswerSheetTypes) });
const adminRoles: Role[] = [Role.SUPER_ADMIN, Role.BRANCH_ADMIN];
const managementRoles: Role[] = [...adminRoles, Role.TEACHER];
const serializable = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;

function bytes(data: { fileName: string; mimeType: AllowedDocumentType; base64: string }) {
  assertDocumentFileExtension(data.fileName, data.mimeType);
  const fileData = decodeVerifiedUpload(data.base64, data.mimeType);
  return { fileName: data.fileName, mimeType: data.mimeType, fileSize: fileData.length, fileData };
}

function auditData(req: AuthRequest, action: string, entity: string, entityId: string) {
  return { organizationId: req.auth!.organizationId, actorId: req.auth!.userId, action, entity, entityId };
}

async function branchAccess(req: AuthRequest, branchId: string) {
  if (req.auth!.role !== Role.BRANCH_ADMIN) return;
  const found = await prisma.branchUser.findFirst({ where: { userId: req.auth!.userId, branchId }, select: { branchId: true } });
  if (!found) throw new AppError(403, "BRANCH_FORBIDDEN", "Branch access denied");
}

async function examination(req: AuthRequest, examinationId: string) {
  const exam = await prisma.examination.findFirst({
    where: { id: examinationId, organizationId: req.auth!.organizationId },
    include: { teacher: { select: { userId: true } }, questionPaper: { select: { id: true, publishedAt: true, _count: { select: { answerSheets: true } } } } },
  });
  if (!exam) throw new AppError(404, "EXAMINATION_NOT_FOUND", "Examination not found");
  await branchAccess(req, exam.branchId);
  return exam;
}

function mayManage(req: AuthRequest, exam: { teacher: { userId: string } }) {
  assertExaminationManager(req.auth!.role, req.auth!.userId, exam.teacher.userId);
}

router.put("/examinations/:examinationId/question-paper", async (req: AuthRequest, res) => {
  const exam = await examination(req, id.parse(req.params.examinationId));
  mayManage(req, exam);
  const data = questionPaperUpload.extend({ publishedAt: z.coerce.date().nullable().optional() }).parse(req.body);
  const file = bytes(data);
  const result = await prisma.$transaction(async tx => {
    const locked = await tx.examination.updateMany({
      where: { id: exam.id, organizationId: req.auth!.organizationId, status: { in: [ExaminationStatus.DRAFT, ExaminationStatus.SCHEDULED] } },
      data: { updatedAt: new Date() },
    });
    assertSingleConditionalMutation(locked.count, "QUESTION_PAPER_LOCKED", "Question papers cannot be changed in the current examination lifecycle");
    const submissions = await tx.examinationAnswerSheet.count({ where: { organizationId: req.auth!.organizationId, examinationId: exam.id } });
    if (submissions) throw new AppError(409, "QUESTION_PAPER_IN_USE", "Question papers with submitted answer sheets cannot be replaced");
    const existing = await tx.examinationQuestionPaper.findUnique({ where: { examinationId: exam.id }, select: { id: true } });
    const paper = await tx.examinationQuestionPaper.upsert({
      where: { examinationId: exam.id },
      update: { ...file, uploadedById: req.auth!.userId, publishedAt: data.publishedAt },
      create: { organizationId: req.auth!.organizationId, examinationId: exam.id, uploadedById: req.auth!.userId, ...file, publishedAt: data.publishedAt },
    });
    await tx.auditLog.create({ data: auditData(req, existing ? "REPLACE" : "UPLOAD", "ExaminationQuestionPaper", paper.id) });
    return { paper, replacing: Boolean(existing) };
  }, serializable);
  res.status(result.replacing ? 200 : 201).json({ data: { ...result.paper, fileData: undefined } });
});

router.get("/examinations/:examinationId/question-paper", async (req: AuthRequest, res) => {
  const exam = await examination(req, id.parse(req.params.examinationId));
  const paper = await loadAuthorizedDocument(async () => {
    if (req.auth!.role === Role.STUDENT) {
      const student = await prisma.studentProfile.findUnique({ where: { userId: req.auth!.userId }, select: { organizationId: true, batchId: true, academicSessionId: true } });
      assertStudentExaminationEligible(student, exam);
      assertQuestionPaperAvailable(exam.status, exam.questionPaper?.publishedAt ?? null);
    } else mayManage(req, exam);
  }, () => prisma.examinationQuestionPaper.findFirst({
      where: { examinationId: exam.id, organizationId: req.auth!.organizationId },
      select: { fileName: true, mimeType: true, fileSize: true, fileData: true },
    }));
  if (!paper) throw new AppError(404, "QUESTION_PAPER_NOT_FOUND", "Question paper not found");
  res.set(storedDocumentHeaders({ ...paper, fallbackName: "question-paper" }, "inline")).send(storedDocumentBuffer(paper.fileData));
});

router.delete("/examinations/:examinationId/question-paper", async (req: AuthRequest, res) => {
  const exam = await examination(req, id.parse(req.params.examinationId));
  mayManage(req, exam);
  await prisma.$transaction(async tx => {
    const locked = await tx.examination.updateMany({
      where: { id: exam.id, organizationId: req.auth!.organizationId, status: { in: [ExaminationStatus.DRAFT, ExaminationStatus.SCHEDULED] } },
      data: { updatedAt: new Date() },
    });
    assertSingleConditionalMutation(locked.count, "QUESTION_PAPER_LOCKED", "Question papers cannot be changed in the current examination lifecycle");
    const paper = await tx.examinationQuestionPaper.findUnique({ where: { examinationId: exam.id }, select: { id: true } });
    if (!paper) throw new AppError(404, "QUESTION_PAPER_NOT_FOUND", "Question paper not found");
    const submissions = await tx.examinationAnswerSheet.count({ where: { organizationId: req.auth!.organizationId, examinationId: exam.id } });
    if (submissions) throw new AppError(409, "QUESTION_PAPER_IN_USE", "Question papers with submitted answer sheets cannot be removed");
    await tx.examinationQuestionPaper.delete({ where: { id: paper.id } });
    await tx.auditLog.create({ data: auditData(req, "REMOVE", "ExaminationQuestionPaper", paper.id) });
  }, serializable);
  res.status(204).send();
});

router.put("/examinations/:examinationId/answer-sheet", async (req: AuthRequest, res) => {
  if (req.auth!.role !== Role.STUDENT) throw new AppError(403, "STUDENT_REQUIRED", "Student access is required");
  const exam = await examination(req, id.parse(req.params.examinationId));
  const student = await prisma.studentProfile.findUnique({ where: { userId: req.auth!.userId }, select: { id: true, organizationId: true, batchId: true, academicSessionId: true } });
  assertStudentExaminationEligible(student, exam);
  const now = new Date();
  const submission = answerSubmissionState(exam, now);
  if (!exam.questionPaper?.publishedAt || exam.questionPaper.publishedAt > now) throw new AppError(409, "SUBMISSION_UNAVAILABLE", "Answer submission is not available for this examination");
  const data = answerSheetUpload.parse(req.body), file = bytes(data);
  const result = await prisma.$transaction(async tx => {
    const locked = await tx.examination.updateMany({
      where: { id: exam.id, organizationId: req.auth!.organizationId, status: submission.examinationStatus },
      data: { updatedAt: now },
    });
    assertSingleConditionalMutation(locked.count, "SUBMISSION_UNAVAILABLE", "Answer submission is closed for the current examination lifecycle");
    const currentPaper = await tx.examinationQuestionPaper.findUnique({ where: { examinationId: exam.id }, select: { id: true, publishedAt: true } });
    if (!currentPaper?.publishedAt || currentPaper.publishedAt > now) throw new AppError(409, "SUBMISSION_UNAVAILABLE", "Answer submission is not available for this examination");
    const old = await tx.examinationAnswerSheet.findUnique({ where: { examinationId_studentId: { examinationId: exam.id, studentId: student.id } } });
    let sheet;
    if (old) {
      assertAnswerSheetReplaceable(old.status, old.finalizedAt);
      const updated = await tx.examinationAnswerSheet.updateMany({
        where: { id: old.id, organizationId: req.auth!.organizationId, examinationId: exam.id, studentId: student.id, status: { in: replaceableAnswerSheetStatuses }, finalizedAt: null },
        data: { ...file, questionPaperId: currentPaper.id, studentRemarks: data.remarks, status: submission.status, isLate: submission.status === AnswerSheetStatus.LATE_SUBMITTED, submittedAt: now, marksObtained: null, teacherRemarks: null, internalNotes: null, evaluatedById: null, evaluatedAt: null, finalizedAt: null },
      });
      assertSingleConditionalMutation(updated.count, "SUBMISSION_FINALIZED", "An answer sheet cannot be replaced after review has started");
      sheet = await tx.examinationAnswerSheet.findUniqueOrThrow({ where: { id: old.id } });
    } else {
      sheet = await tx.examinationAnswerSheet.create({ data: { organizationId: req.auth!.organizationId, examinationId: exam.id, questionPaperId: currentPaper.id, studentId: student.id, ...file, studentRemarks: data.remarks, status: submission.status, isLate: submission.status === AnswerSheetStatus.LATE_SUBMITTED, submittedAt: now } });
    }
    await tx.auditLog.create({ data: auditData(req, old ? "REPLACE" : "SUBMIT", "ExaminationAnswerSheet", sheet.id) });
    return { sheet, replacing: Boolean(old) };
  }, serializable);
  res.status(result.replacing ? 200 : 201).json({ data: { ...result.sheet, fileData: undefined } });
});

router.get("/examinations/:examinationId/answer-sheets", async (req: AuthRequest, res) => {
  const exam = await examination(req, id.parse(req.params.examinationId));
  mayManage(req, exam);
  const data = await prisma.examinationAnswerSheet.findMany({ where: { examinationId: exam.id }, select: { id: true, fileName: true, mimeType: true, fileSize: true, studentRemarks: true, status: true, isLate: true, marksObtained: true, teacherRemarks: true, internalNotes: true, evaluatedAt: true, finalizedAt: true, submittedAt: true, student: { select: { id: true, admissionNo: true, rollNo: true, user: { select: { name: true } } } } }, orderBy: { submittedAt: "asc" } });
  res.json({ data });
});

router.get("/answer-sheets/:answerSheetId/file", async (req: AuthRequest, res) => {
  const answerSheetId = id.parse(req.params.answerSheetId);
  let authorization: Record<string, unknown>;
  if (req.auth!.role === Role.STUDENT) authorization = { student: { userId: req.auth!.userId } };
  else if (req.auth!.role === Role.TEACHER) authorization = { examination: { teacher: { userId: req.auth!.userId } } };
  else if (req.auth!.role === Role.BRANCH_ADMIN) {
    const branchIds = (await prisma.branchUser.findMany({ where: { userId: req.auth!.userId }, select: { branchId: true } })).map(row => row.branchId);
    authorization = { examination: { branchId: { in: branchIds } } };
  } else if (req.auth!.role === Role.SUPER_ADMIN) authorization = {};
  else throw new AppError(404, "ANSWER_SHEET_NOT_FOUND", "Answer sheet not found");
  const authorized = await prisma.examinationAnswerSheet.findFirst({ where: { id: answerSheetId, organizationId: req.auth!.organizationId, ...authorization }, select: { id: true } });
  if (!authorized) throw new AppError(404, "ANSWER_SHEET_NOT_FOUND", "Answer sheet not found");
  const sheet = await prisma.examinationAnswerSheet.findUnique({ where: { id: authorized.id }, select: { fileName: true, mimeType: true, fileSize: true, fileData: true } });
  if (!sheet) throw new AppError(404, "ANSWER_SHEET_NOT_FOUND", "Answer sheet not found");
  res.set(storedDocumentHeaders({ ...sheet, fallbackName: "answer-sheet" }, "inline")).send(storedDocumentBuffer(sheet.fileData));
});

router.patch("/answer-sheets/:answerSheetId/evaluation", async (req: AuthRequest, res) => {
  const sheet = await prisma.examinationAnswerSheet.findUnique({ where: { id: id.parse(req.params.answerSheetId) }, include: { examination: { include: { teacher: { select: { userId: true } } } } } });
  if (!sheet) throw new AppError(404, "ANSWER_SHEET_NOT_FOUND", "Answer sheet not found");
  await branchAccess(req, sheet.examination.branchId);
  mayManage(req, sheet.examination);
  assertEvaluationOpen(sheet.finalizedAt);
  if (sheet.examination.status !== ExaminationStatus.COMPLETED) throw new AppError(409, "EVALUATION_UNAVAILABLE", "Evaluation is allowed only after the examination is completed");
  const data = z.object({ marksObtained: z.coerce.number().min(0), teacherRemarks: z.string().trim().max(5000).nullable().optional(), internalNotes: z.string().trim().max(5000).nullable().optional(), finalize: z.boolean().default(false) }).parse(req.body);
  if (data.marksObtained > sheet.examination.maximumMarks) throw new AppError(422, "MARKS_EXCEED_MAXIMUM", "Marks cannot exceed examination maximum marks");
  const now = new Date();
  const updated = await prisma.$transaction(async tx => {
    const locked = await tx.examination.updateMany({ where: { id: sheet.examinationId, organizationId: req.auth!.organizationId, status: ExaminationStatus.COMPLETED }, data: { updatedAt: now } });
    assertSingleConditionalMutation(locked.count, "EVALUATION_UNAVAILABLE", "Evaluation is closed for the current examination lifecycle");
    const answer = await tx.examinationAnswerSheet.updateMany({ where: { id: sheet.id, organizationId: req.auth!.organizationId, examinationId: sheet.examinationId, studentId: sheet.studentId, finalizedAt: null, status: { in: [AnswerSheetStatus.SUBMITTED, AnswerSheetStatus.LATE_SUBMITTED, AnswerSheetStatus.UNDER_REVIEW] } }, data: { marksObtained: data.marksObtained, teacherRemarks: data.teacherRemarks, internalNotes: data.internalNotes, evaluatedById: req.auth!.userId, evaluatedAt: now, status: evaluationStatus(data.finalize), ...(data.finalize ? { finalizedAt: now } : {}) } });
    assertSingleConditionalMutation(answer.count, "EVALUATION_FINALIZED", "A finalized evaluation cannot be modified");
    if (data.finalize) {
      const result = examinationResultFor(data.marksObtained, sheet.examination.maximumMarks, sheet.examination.passingMarks, now);
      await tx.examinationResult.upsert({ where: { examinationId_studentId: { examinationId: sheet.examinationId, studentId: sheet.studentId } }, update: { ...result, remarks: data.teacherRemarks }, create: { organizationId: req.auth!.organizationId, examinationId: sheet.examinationId, studentId: sheet.studentId, ...result, remarks: data.teacherRemarks } });
    }
    const value = await tx.examinationAnswerSheet.findUniqueOrThrow({ where: { id: sheet.id } });
    await tx.auditLog.create({ data: auditData(req, data.finalize ? "FINALIZE" : "EVALUATE", "ExaminationAnswerSheet", value.id) });
    return value;
  }, serializable);
  res.json({ data: { ...updated, fileData: undefined } });
});

router.get("/examinations", async (req: AuthRequest, res) => {
  if (req.auth!.role === Role.STUDENT) {
    const student = await prisma.studentProfile.findUnique({ where: { userId: req.auth!.userId }, select: { id: true, batchId: true, academicSessionId: true } });
    if (!student) throw new AppError(404, "STUDENT_PROFILE_NOT_FOUND", "Student profile not found");
    const data = await prisma.examination.findMany({ where: { batchId: student.batchId, academicSessionId: student.academicSessionId, status: { in: [ExaminationStatus.SCHEDULED, ExaminationStatus.COMPLETED, ExaminationStatus.RESULTS_PUBLISHED] } }, select: { id: true, name: true, status: true, examDate: true, startMinute: true, endMinute: true, maximumMarks: true, subject: { select: { name: true } }, questionPaper: { select: { id: true, fileName: true, publishedAt: true } }, answerSheets: { where: { studentId: student.id }, select: { id: true, fileName: true, status: true, isLate: true, marksObtained: true, teacherRemarks: true, submittedAt: true, finalizedAt: true } } }, orderBy: { examDate: "desc" } });
    return res.json({ data: data.map(row => ({ ...row, questionPaper: row.questionPaper?.publishedAt && row.questionPaper.publishedAt <= new Date() ? row.questionPaper : null, answerSheet: row.answerSheets[0] ? publishedEvaluation(row.status, row.answerSheets[0]) : null, answerSheets: undefined })) });
  }
  if (!managementRoles.includes(req.auth!.role)) throw new AppError(403, "FORBIDDEN", "Examination access denied");
  const teacher = req.auth!.role === Role.TEACHER ? await prisma.teacherProfile.findUnique({ where: { userId: req.auth!.userId }, select: { id: true } }) : null;
  const branchIds = req.auth!.role === Role.BRANCH_ADMIN ? (await prisma.branchUser.findMany({ where: { userId: req.auth!.userId }, select: { branchId: true } })).map(row => row.branchId) : null;
  const data = await prisma.examination.findMany({ where: { ...(teacher ? { teacherId: teacher.id } : {}), ...(branchIds ? { branchId: { in: branchIds } } : {}) }, select: { id: true, name: true, status: true, examDate: true, maximumMarks: true, batch: { select: { name: true } }, subject: { select: { name: true } }, questionPaper: { select: { id: true, fileName: true, publishedAt: true } }, _count: { select: { answerSheets: true } } }, orderBy: { examDate: "desc" }, take: 100 });
  res.json({ data });
});

export default router;
