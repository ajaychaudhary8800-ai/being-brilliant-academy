import { Prisma, Role, SubjectLegacyReviewStatus, SubjectStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { ensureEducationCatalogs } from "../lib/education-catalogs.js";
import { AppError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { buildSubjectMergePlan, countSubjectDependencies, describeSubjectDependencies, usedSubjectDependencies } from "../lib/subject-dependencies.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN));
const id = z.string().cuid();
const subjectInput = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().toUpperCase().min(1).max(30).regex(/^[A-Z0-9-]+$/),
  description: z.string().trim().max(2000).nullable().optional(),
  status: z.nativeEnum(SubjectStatus).default(SubjectStatus.ACTIVE),
  legacyReviewStatus: z.nativeEnum(SubjectLegacyReviewStatus).optional(),
});
const subjectSelect = {
  id: true, name: true, code: true, description: true, status: true, legacyReviewStatus: true, createdAt: true, updatedAt: true,
  _count: { select: { courses: true, teachers: true, teacherAllocations: true, timetables: true, homeworks: true, examinations: true, substitutions: true } },
} as const;

function duplicate(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
function audit(req: AuthRequest, action: string, entityId: string, metadata?: object) {
  return prisma.auditLog.create({ data: { actorId: req.auth!.userId, action, entity: "Subject", entityId, metadata } });
}
function requireOrganizationAdmin(req: AuthRequest) {
  if (req.auth!.role !== Role.SUPER_ADMIN) throw new AppError(403, "ORGANIZATION_ADMIN_REQUIRED", "Only an organization administrator can clean up migrated subjects");
}

router.get("/subjects", async (req: AuthRequest, res) => {
  await ensureEducationCatalogs(prisma, req.auth!.organizationId);
  const query = z.object({
    page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().optional(), status: z.nativeEnum(SubjectStatus).optional(),
    reviewStatus: z.nativeEnum(SubjectLegacyReviewStatus).optional(), sortBy: z.enum(["name", "code", "status", "createdAt", "updatedAt"]).default("name"),
    sortOrder: z.enum(["asc", "desc"]).default("asc"),
  }).parse(req.query);
  const where = {
    ...(query.status ? { status: query.status } : {}), ...(query.reviewStatus ? { legacyReviewStatus: query.reviewStatus } : {}),
    ...(query.search ? { OR: [{ name: { contains: query.search, mode: "insensitive" as const } }, { code: { contains: query.search, mode: "insensitive" as const } }, { description: { contains: query.search, mode: "insensitive" as const } }] } : {}),
  };
  const [total, data] = await prisma.$transaction([
    prisma.subject.count({ where }),
    prisma.subject.findMany({ where, select: subjectSelect, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: { [query.sortBy]: query.sortOrder } }),
  ]);
  res.json({ data, meta: { total, page: query.page, limit: query.limit, totalPages: Math.max(1, Math.ceil(total / query.limit)) } });
});

router.get("/subjects/options", async (req: AuthRequest, res) => {
  await ensureEducationCatalogs(prisma, req.auth!.organizationId);
  const data = await prisma.subject.findMany({ where: { status: SubjectStatus.ACTIVE, legacyReviewStatus: SubjectLegacyReviewStatus.CONFIRMED }, select: { id: true, name: true, code: true }, orderBy: { name: "asc" } });
  res.json({ data });
});

router.get("/allocation-subject-options", async (req: AuthRequest, res) => {
  const query = z.object({ teacherId: id, courseId: id }).parse(req.query);
  const [teacher, course] = await Promise.all([prisma.teacherProfile.findUnique({ where: { id: query.teacherId }, select: { branchId: true } }), prisma.course.findUnique({ where: { id: query.courseId }, select: { branchId: true } })]);
  if (!teacher || !course || course.branchId && course.branchId !== teacher.branchId) throw new AppError(422, "INVALID_ALLOCATION_CONTEXT", "Teacher and course must be available in the same branch");
  if (req.auth!.role === Role.BRANCH_ADMIN && !await prisma.branchUser.findFirst({ where: { userId: req.auth!.userId, branchId: teacher.branchId }, select: { branchId: true } })) throw new AppError(403, "BRANCH_FORBIDDEN", "Branch access denied");
  const teacherSubjects = await prisma.teacherSubject.findMany({ where: { teacherId: query.teacherId }, select: { subjectId: true } });
  const data = await prisma.courseSubject.findMany({ where: { courseId: query.courseId, isActive: true, subjectId: { in: teacherSubjects.map(row => row.subjectId) }, subject: { status: SubjectStatus.ACTIVE, legacyReviewStatus: SubjectLegacyReviewStatus.CONFIRMED } }, select: { subject: { select: { id: true, name: true, code: true } } }, orderBy: { subject: { name: "asc" } } });
  res.json({ data: data.map(row => row.subject), meta: { reason: data.length ? null : "NO_COMMON_TEACHER_COURSE_SUBJECT" } });
});

router.get("/subjects/:id/dependencies", async (req: AuthRequest, res) => {
  const subjectId = id.parse(req.params.id);
  const subject = await prisma.subject.findUnique({ where: { id: subjectId }, select: { id: true, name: true, code: true } });
  if (!subject) throw new AppError(404, "SUBJECT_NOT_FOUND", "Subject not found");
  const dependencies = await countSubjectDependencies(prisma, req.auth!.organizationId, subject.id);
  res.json({ data: { subject, dependencies, total: usedSubjectDependencies(dependencies).reduce((total, [, count]) => total + count, 0) } });
});

router.get("/subjects/:id/merge-preview", async (req: AuthRequest, res) => {
  requireOrganizationAdmin(req);
  const sourceSubjectId = id.parse(req.params.id), { replacementSubjectId } = z.object({ replacementSubjectId: id }).parse(req.query);
  if (sourceSubjectId === replacementSubjectId) throw new AppError(422, "SAME_SUBJECT", "Choose a different replacement subject");
  const [source, replacement] = await Promise.all([
    prisma.subject.findUnique({ where: { id: sourceSubjectId }, select: { id: true, name: true, code: true, status: true, legacyReviewStatus: true } }),
    prisma.subject.findUnique({ where: { id: replacementSubjectId }, select: { id: true, name: true, code: true, status: true, legacyReviewStatus: true } }),
  ]);
  if (!source || !replacement) throw new AppError(404, "SUBJECT_NOT_FOUND", "Source or replacement subject was not found in this organization");
  if (source.legacyReviewStatus !== SubjectLegacyReviewStatus.REVIEW_REQUIRED) throw new AppError(409, "SOURCE_NOT_REVIEW_REQUIRED", "Only a migrated review-required subject can use this cleanup workflow");
  if (replacement.status !== SubjectStatus.ACTIVE || replacement.legacyReviewStatus !== SubjectLegacyReviewStatus.CONFIRMED) throw new AppError(422, "INVALID_REPLACEMENT_SUBJECT", "Replacement must be an active, confirmed subject in this organization");
  res.json({ data: { source, replacement, ...(await buildSubjectMergePlan(prisma, req.auth!.organizationId, source.id, replacement.id)) } });
});

router.post("/subjects/:id/merge", async (req: AuthRequest, res) => {
  requireOrganizationAdmin(req);
  const sourceSubjectId = id.parse(req.params.id), { replacementSubjectId } = z.object({ replacementSubjectId: id }).parse(req.body);
  if (sourceSubjectId === replacementSubjectId) throw new AppError(422, "SAME_SUBJECT", "Choose a different replacement subject");
  const data = await prisma.$transaction(async tx => {
    const [source, replacement] = await Promise.all([
      tx.subject.findFirst({ where: { id: sourceSubjectId, organizationId: req.auth!.organizationId }, select: { id: true, name: true, code: true, status: true, legacyReviewStatus: true } }),
      tx.subject.findFirst({ where: { id: replacementSubjectId, organizationId: req.auth!.organizationId }, select: { id: true, name: true, code: true, status: true, legacyReviewStatus: true } }),
    ]);
    if (!source || !replacement) throw new AppError(404, "SUBJECT_NOT_FOUND", "Source or replacement subject was not found in this organization");
    if (source.legacyReviewStatus !== SubjectLegacyReviewStatus.REVIEW_REQUIRED) throw new AppError(409, "SOURCE_NOT_REVIEW_REQUIRED", "Only a migrated review-required subject can use this cleanup workflow");
    if (replacement.status !== SubjectStatus.ACTIVE || replacement.legacyReviewStatus !== SubjectLegacyReviewStatus.CONFIRMED) throw new AppError(422, "INVALID_REPLACEMENT_SUBJECT", "Replacement must be an active, confirmed subject in this organization");
    const plan = await buildSubjectMergePlan(tx, req.auth!.organizationId, source.id, replacement.id);
    if (!plan.canMerge) {
      const reasons = [
        ...plan.blockingDependencies.map(item => `${item.count} ${item.label}`),
        ...(plan.unmatchedCourseIds.length ? [`${plan.unmatchedCourseIds.length} course mappings do not yet use the replacement`] : []),
        ...(plan.unmatchedTeacherIds.length ? [`${plan.unmatchedTeacherIds.length} teacher mappings do not yet use the replacement`] : []),
      ];
      throw new AppError(409, "SUBJECT_MERGE_BLOCKED", `Cleanup is blocked: ${reasons.join(", ")}`);
    }
    if (plan.duplicateCourseIds.length) await tx.courseSubject.deleteMany({ where: { organizationId: req.auth!.organizationId, subjectId: source.id, courseId: { in: plan.duplicateCourseIds } } });
    if (plan.duplicateTeacherIds.length) await tx.teacherSubject.deleteMany({ where: { organizationId: req.auth!.organizationId, subjectId: source.id, teacherId: { in: plan.duplicateTeacherIds } } });
    await tx.subject.update({ where: { id: source.id }, data: { status: SubjectStatus.INACTIVE } });
    await tx.auditLog.create({ data: { organizationId: req.auth!.organizationId, actorId: req.auth!.userId, action: "REDUNDANT_RELATIONSHIPS_CLEANED", entity: "Subject", entityId: source.id, metadata: { replacementSubjectId: replacement.id, removedCourseMappings: plan.duplicateCourseIds.length, removedTeacherMappings: plan.duplicateTeacherIds.length, historicalRecordsRewritten: false, legacySnapshotsRewritten: false } } });
    return { source: { ...source, status: SubjectStatus.INACTIVE }, replacement, removedCourseMappings: plan.duplicateCourseIds.length, removedTeacherMappings: plan.duplicateTeacherIds.length };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  res.json({ data });
});

router.get("/subjects/:id", async (req, res) => {
  const data = await prisma.subject.findUnique({ where: { id: id.parse(req.params.id) }, select: subjectSelect });
  if (!data) throw new AppError(404, "SUBJECT_NOT_FOUND", "Subject not found");
  res.json({ data });
});

router.post("/subjects", async (req: AuthRequest, res) => {
  const input = subjectInput.parse(req.body);
  try {
    const data = await prisma.subject.create({ data: { ...input, legacyReviewStatus: SubjectLegacyReviewStatus.CONFIRMED }, select: subjectSelect });
    await audit(req, "CREATE", data.id, { name: data.name, code: data.code });
    res.status(201).json({ data });
  } catch (error) {
    if (duplicate(error)) throw new AppError(409, "SUBJECT_DUPLICATE", "A subject with this name or code already exists in this organization");
    throw error;
  }
});

router.patch("/subjects/:id", async (req: AuthRequest, res) => {
  const subjectId = id.parse(req.params.id), input = subjectInput.partial().parse(req.body);
  const existing = await prisma.subject.findUnique({ where: { id: subjectId }, select: { id: true } });
  if (!existing) throw new AppError(404, "SUBJECT_NOT_FOUND", "Subject not found");
  try {
    const data = await prisma.subject.update({ where: { id: subjectId }, data: input, select: subjectSelect });
    await audit(req, "UPDATE", data.id, input);
    res.json({ data });
  } catch (error) {
    if (duplicate(error)) throw new AppError(409, "SUBJECT_DUPLICATE", "A subject with this name or code already exists in this organization");
    throw error;
  }
});

router.patch("/subjects/:id/status", async (req: AuthRequest, res) => {
  const subjectId = id.parse(req.params.id), { status } = z.object({ status: z.nativeEnum(SubjectStatus) }).parse(req.body);
  const existing = await prisma.subject.findUnique({ where: { id: subjectId }, select: { id: true } });
  if (!existing) throw new AppError(404, "SUBJECT_NOT_FOUND", "Subject not found");
  const data = await prisma.subject.update({ where: { id: subjectId }, data: { status }, select: subjectSelect });
  await audit(req, status === SubjectStatus.ACTIVE ? "ACTIVATE" : "DEACTIVATE", data.id);
  res.json({ data });
});

router.delete("/subjects/:id", async (req: AuthRequest, res) => {
  const subjectId = id.parse(req.params.id);
  await prisma.$transaction(async tx => {
    const existing = await tx.subject.findFirst({ where: { id: subjectId, organizationId: req.auth!.organizationId }, select: { id: true, status: true } });
    if (!existing) throw new AppError(404, "SUBJECT_NOT_FOUND", "Subject not found");
    if (existing.status !== SubjectStatus.INACTIVE) throw new AppError(409, "DEACTIVATE_BEFORE_DELETE", "Deactivate the subject before deleting it");
    const dependencies = await countSubjectDependencies(tx, req.auth!.organizationId, existing.id);
    if (usedSubjectDependencies(dependencies).length) throw new AppError(409, "SUBJECT_IN_USE", `This subject cannot be deleted because it is used by ${describeSubjectDependencies(dependencies)}`);
    await tx.subject.delete({ where: { id: subjectId } });
    await tx.auditLog.create({ data: { organizationId: req.auth!.organizationId, actorId: req.auth!.userId, action: "DELETE", entity: "Subject", entityId: subjectId, metadata: { dependencyCounts: dependencies } } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  res.status(204).send();
});

router.get("/teachers/:id/subjects", async (req: AuthRequest, res) => {
  const teacher = await prisma.teacherProfile.findUnique({ where: { id: id.parse(req.params.id) }, select: { id: true, branchId: true, subjects: { select: { subject: { select: { id: true, name: true, code: true, status: true, legacyReviewStatus: true } } }, orderBy: { subject: { name: "asc" } } } } });
  if (!teacher) throw new AppError(404, "TEACHER_NOT_FOUND", "Teacher not found");
  if (req.auth!.role === Role.BRANCH_ADMIN && !await prisma.branchUser.findFirst({ where: { userId: req.auth!.userId, branchId: teacher.branchId }, select: { branchId: true } })) throw new AppError(403, "BRANCH_FORBIDDEN", "Branch access denied");
  res.json({ data: teacher.subjects.map(row => row.subject) });
});

router.put("/teachers/:id/subjects", async (req: AuthRequest, res) => {
  const teacherId = id.parse(req.params.id), { subjectIds } = z.object({ subjectIds: z.array(id).max(100) }).parse(req.body);
  if (new Set(subjectIds).size !== subjectIds.length) throw new AppError(422, "DUPLICATE_SUBJECT_SELECTION", "Select each subject only once");
  const teacher = await prisma.teacherProfile.findUnique({ where: { id: teacherId }, select: { id: true, branchId: true } });
  if (!teacher) throw new AppError(404, "TEACHER_NOT_FOUND", "Teacher not found");
  if (req.auth!.role === Role.BRANCH_ADMIN && !await prisma.branchUser.findFirst({ where: { userId: req.auth!.userId, branchId: teacher.branchId }, select: { branchId: true } })) throw new AppError(403, "BRANCH_FORBIDDEN", "Branch access denied");
  const subjects = await prisma.subject.findMany({ where: { id: { in: subjectIds }, status: SubjectStatus.ACTIVE, legacyReviewStatus: SubjectLegacyReviewStatus.CONFIRMED }, select: { id: true } });
  if (subjects.length !== subjectIds.length) throw new AppError(422, "INVALID_SUBJECT_SELECTION", "Every selected subject must be active, confirmed and belong to this organization");
  const activeAllocation = await prisma.teacherAllocation.findFirst({ where: { teacherId, status: "ACTIVE", subjectId: { notIn: subjectIds } }, select: { id: true } });
  if (activeAllocation) throw new AppError(409, "TEACHER_SUBJECT_IN_USE", "Deactivate active teacher allocations before removing their subject mapping");
  await prisma.$transaction(async tx => {
    await tx.teacherSubject.deleteMany({ where: { teacherId, subjectId: { notIn: subjectIds } } });
    if (subjectIds.length) await tx.teacherSubject.createMany({ data: subjectIds.map(subjectId => ({ organizationId: req.auth!.organizationId, teacherId, subjectId })), skipDuplicates: true });
  });
  await prisma.auditLog.create({ data: { actorId: req.auth!.userId, action: "SUBJECTS_UPDATED", entity: "TeacherProfile", entityId: teacherId, metadata: { subjectIds } } });
  res.json({ data: await prisma.teacherSubject.findMany({ where: { teacherId }, select: { subject: { select: { id: true, name: true, code: true } } }, orderBy: { subject: { name: "asc" } } }) });
});

export default router;
