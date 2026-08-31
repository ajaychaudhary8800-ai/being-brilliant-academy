import { Prisma, Role, SubjectLegacyReviewStatus, SubjectStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
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

router.get("/subjects", async (req: AuthRequest, res) => {
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

router.get("/subjects/options", async (_req, res) => {
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
  const existing = await prisma.subject.findUnique({ where: { id: subjectId }, select: { id: true, status: true, _count: subjectSelect._count } });
  if (!existing) throw new AppError(404, "SUBJECT_NOT_FOUND", "Subject not found");
  if (existing.status !== SubjectStatus.INACTIVE) throw new AppError(409, "DEACTIVATE_BEFORE_DELETE", "Deactivate the subject before deleting it");
  if (Object.values(existing._count).some(Boolean)) throw new AppError(409, "SUBJECT_IN_USE", "This subject has academic history and cannot be deleted");
  await prisma.subject.delete({ where: { id: subjectId } });
  await audit(req, "DELETE", subjectId);
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
