import { Prisma, Role, SubjectLegacyReviewStatus, SubjectStatus, TeacherAllocationStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN));
const id = z.string().cuid();
// Transitional compatibility for pre-normalization clients: resolve only an
// exact database-backed name already valid for the chosen teacher and course.
// Unknown or ambiguous free text is never created or guessed.
router.use(async (req, _res, next) => {
  if (!(["POST", "PUT"].includes(req.method)) || req.body?.subjectId || typeof req.body?.subjectName !== "string") return next();
  const context = z.object({ teacherId: id, courseId: id, subjectName: z.string().trim().min(1).max(120) }).parse(req.body);
  const subject = await prisma.subject.findFirst({ where: { name: { equals: context.subjectName, mode: "insensitive" }, status: SubjectStatus.ACTIVE, legacyReviewStatus: SubjectLegacyReviewStatus.CONFIRMED, teachers: { some: { teacherId: context.teacherId } }, courses: { some: { courseId: context.courseId, isActive: true } } }, select: { id: true } });
  if (!subject) throw new AppError(422, "INVALID_LEGACY_SUBJECT", "Select a confirmed subject mapped to both the teacher and course");
  req.body = { ...req.body, subjectId: subject.id };
  next();
});
const input = z.object({
  academicSessionId: id, branchId: id, courseId: id, batchId: id, teacherId: id, subjectId: id,
  weeklyPeriods: z.number().int().min(1).max(100), effectiveFrom: z.coerce.date(), effectiveTo: z.coerce.date().nullable().optional(),
  remarks: z.string().trim().max(2000).nullable().optional(), status: z.nativeEnum(TeacherAllocationStatus).default(TeacherAllocationStatus.ACTIVE),
});
const query = z.object({
  page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20), search: z.string().trim().optional(),
  academicSessionId: id.optional(), branchId: id.optional(), courseId: id.optional(), batchId: id.optional(), teacherId: id.optional(), subjectId: id.optional(),
  subject: z.string().trim().optional(), status: z.nativeEnum(TeacherAllocationStatus).optional(),
  sortBy: z.enum(["subjectName", "weeklyPeriods", "effectiveFrom", "status", "createdAt", "updatedAt"]).default("createdAt"), sortOrder: z.enum(["asc", "desc"]).default("desc"),
});
const select = {
  id: true, organizationId: true, branchId: true, academicSessionId: true, courseId: true, batchId: true, teacherId: true, subjectId: true,
  subjectName: true, weeklyPeriods: true, effectiveFrom: true, effectiveTo: true, remarks: true, status: true, createdAt: true, updatedAt: true,
  academicSession: { select: { id: true, name: true, isArchived: true } }, branch: { select: { id: true, branchName: true, branchCode: true } },
  course: { select: { id: true, title: true, courseCode: true } }, batch: { select: { id: true, name: true, code: true } },
  teacher: { select: { id: true, employeeNo: true, user: { select: { id: true, name: true, isActive: true } } } },
  subject: { select: { id: true, name: true, code: true, status: true, legacyReviewStatus: true } },
  createdBy: { select: { id: true, name: true } }, updatedBy: { select: { id: true, name: true } },
} as const;

async function allowedBranches(req: AuthRequest) {
  if (req.auth!.role !== Role.BRANCH_ADMIN) return null;
  return (await prisma.branchUser.findMany({ where: { userId: req.auth!.userId }, select: { branchId: true } })).map(row => row.branchId);
}
async function requireBranch(req: AuthRequest, branchId: string) {
  const allowed = await allowedBranches(req);
  if (allowed && !allowed.includes(branchId)) throw new AppError(403, "BRANCH_FORBIDDEN", "You do not have access to this branch");
}
function validateDates(from: Date, to?: Date | null) {
  if (to && to < from) throw new AppError(422, "INVALID_DATES", "Effective To must be on or after Effective From");
}
async function validateRelations(req: AuthRequest, data: z.infer<typeof input>, existingId?: string) {
  await requireBranch(req, data.branchId);
  const [branch, session, course, batch, teacher, subject, teacherSubject, courseSubject] = await Promise.all([
    prisma.branch.findUnique({ where: { id: data.branchId }, select: { id: true, isActive: true } }),
    prisma.academicSession.findUnique({ where: { id: data.academicSessionId }, select: { id: true, isArchived: true } }),
    prisma.course.findUnique({ where: { id: data.courseId }, select: { id: true, branchId: true } }),
    prisma.batch.findUnique({ where: { id: data.batchId }, select: { id: true, branchId: true, courseId: true, academicSessionId: true } }),
    prisma.teacherProfile.findUnique({ where: { id: data.teacherId }, select: { id: true, branchId: true, user: { select: { isActive: true } } } }),
    prisma.subject.findUnique({ where: { id: data.subjectId }, select: { id: true, name: true, status: true, legacyReviewStatus: true } }),
    prisma.teacherSubject.findUnique({ where: { teacherId_subjectId: { teacherId: data.teacherId, subjectId: data.subjectId } }, select: { subjectId: true } }),
    prisma.courseSubject.findUnique({ where: { courseId_subjectId: { courseId: data.courseId, subjectId: data.subjectId } }, select: { isActive: true } }),
  ]);
  if (!branch) throw new AppError(422, "INVALID_BRANCH", "Select a valid branch");
  if (!session) throw new AppError(422, "INVALID_ACADEMIC_SESSION", "Select a valid academic session");
  if (!course || course.branchId && course.branchId !== data.branchId) throw new AppError(422, "INVALID_COURSE", "Select a course available to the selected branch");
  if (!batch || batch.branchId !== data.branchId || batch.courseId !== data.courseId || batch.academicSessionId !== data.academicSessionId) throw new AppError(422, "INVALID_BATCH", "The academic group must match the selected branch, course and academic session");
  if (!teacher || teacher.branchId !== data.branchId) throw new AppError(422, "INVALID_TEACHER", "Teacher must belong to the selected branch");
  if (!subject || !teacherSubject || !courseSubject?.isActive || subject.status !== SubjectStatus.ACTIVE) throw new AppError(422, "INVALID_SUBJECT", "Subject must be active and mapped to both the teacher and course");
  if (subject.legacyReviewStatus !== SubjectLegacyReviewStatus.CONFIRMED) {
    const existing = existingId ? await prisma.teacherAllocation.findFirst({ where: { id: existingId, subjectId: data.subjectId }, select: { id: true } }) : null;
    if (!existing) throw new AppError(409, "SUBJECT_REVIEW_REQUIRED", "Confirm this legacy subject in Subject Master before using it in a new allocation");
  }
  if (data.status === TeacherAllocationStatus.ACTIVE && (!branch.isActive || session.isArchived || !teacher.user.isActive)) throw new AppError(409, "INACTIVE_RELATION", "Active allocations require an active branch, session and teacher");
  return subject;
}
async function ensureUnique(data: z.infer<typeof input>, excludeId?: string) {
  if (data.status !== TeacherAllocationStatus.ACTIVE) return;
  const duplicate = await prisma.teacherAllocation.findFirst({ where: {
    ...(excludeId ? { id: { not: excludeId } } : {}), teacherId: data.teacherId, batchId: data.batchId, academicSessionId: data.academicSessionId,
    subjectId: data.subjectId, status: TeacherAllocationStatus.ACTIVE,
    effectiveFrom: { lte: data.effectiveTo ?? new Date("9999-12-31T00:00:00.000Z") }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: data.effectiveFrom } }],
  }, select: { id: true } });
  if (duplicate) throw new AppError(409, "ACTIVE_ALLOCATION_OVERLAP", "An active allocation already overlaps for this teacher, subject, academic group and session");
}
function audit(req: AuthRequest, action: string, entityId: string, metadata?: object) {
  return prisma.auditLog.create({ data: { actorId: req.auth!.userId, action, entity: "TeacherAllocation", entityId, metadata } });
}
async function allocationWrite<T>(operation: () => Promise<T>) { try { return await operation(); } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new AppError(409, "ACTIVE_ALLOCATION_OVERLAP", "An active allocation already exists for this teacher, subject, academic group and session"); throw error; } }

router.get("/teacher-allocations", async (req: AuthRequest, res) => {
  const q = query.parse(req.query), allowed = await allowedBranches(req); if (q.branchId) await requireBranch(req, q.branchId);
  const where = { ...(allowed ? { branchId: { in: allowed } } : {}), ...(q.academicSessionId ? { academicSessionId: q.academicSessionId } : {}), ...(q.branchId ? { branchId: q.branchId } : {}), ...(q.courseId ? { courseId: q.courseId } : {}), ...(q.batchId ? { batchId: q.batchId } : {}), ...(q.teacherId ? { teacherId: q.teacherId } : {}), ...(q.subjectId ? { subjectId: q.subjectId } : {}), ...(q.subject ? { subjectName: { contains: q.subject, mode: "insensitive" as const } } : {}), ...(q.status ? { status: q.status } : {}), ...(q.search ? { OR: [{ subjectName: { contains: q.search, mode: "insensitive" as const } }, { remarks: { contains: q.search, mode: "insensitive" as const } }, { teacher: { user: { name: { contains: q.search, mode: "insensitive" as const } } } }, { batch: { name: { contains: q.search, mode: "insensitive" as const } } }, { course: { title: { contains: q.search, mode: "insensitive" as const } } }] } : {}) };
  const [total, data] = await prisma.$transaction([prisma.teacherAllocation.count({ where }), prisma.teacherAllocation.findMany({ where, select, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { [q.sortBy]: q.sortOrder } })]);
  res.json({ data, meta: { total, page: q.page, limit: q.limit, totalPages: Math.max(1, Math.ceil(total / q.limit)) } });
});
router.get("/teacher-allocations/:id", async (req: AuthRequest, res) => { const data = await prisma.teacherAllocation.findUnique({ where: { id: id.parse(req.params.id) }, select }); if (!data) throw new AppError(404, "ALLOCATION_NOT_FOUND", "Teacher allocation not found"); await requireBranch(req, data.branchId); res.json({ data }); });
router.post("/teacher-allocations", async (req: AuthRequest, res) => { const data = input.parse(req.body); validateDates(data.effectiveFrom, data.effectiveTo); const subject = await validateRelations(req, data); await ensureUnique(data); const created = await allocationWrite(() => prisma.teacherAllocation.create({ data: { ...data, organizationId: req.auth!.organizationId, subjectName: subject.name, createdById: req.auth!.userId, updatedById: req.auth!.userId }, select })); await audit(req, "CREATE", created.id, { subjectId: created.subjectId, status: created.status }); res.status(201).json({ data: created }); });
router.put("/teacher-allocations/:id", async (req: AuthRequest, res) => { const allocationId = id.parse(req.params.id), old = await prisma.teacherAllocation.findUnique({ where: { id: allocationId }, select: { id: true, branchId: true } }); if (!old) throw new AppError(404, "ALLOCATION_NOT_FOUND", "Teacher allocation not found"); await requireBranch(req, old.branchId); const data = input.parse(req.body); validateDates(data.effectiveFrom, data.effectiveTo); const subject = await validateRelations(req, data, old.id); await ensureUnique(data, old.id); const updated = await allocationWrite(() => prisma.teacherAllocation.update({ where: { id: old.id }, data: { ...data, subjectName: subject.name, updatedById: req.auth!.userId }, select })); await audit(req, "UPDATE", updated.id, { subjectId: updated.subjectId, status: updated.status }); res.json({ data: updated }); });
async function setStatus(req: AuthRequest, status: TeacherAllocationStatus) { const allocationId = id.parse(req.params.id), old = await prisma.teacherAllocation.findUnique({ where: { id: allocationId }, select: { id: true, branchId: true, academicSessionId: true, courseId: true, batchId: true, teacherId: true, subjectId: true, weeklyPeriods: true, effectiveFrom: true, effectiveTo: true, remarks: true, status: true } }); if (!old) throw new AppError(404, "ALLOCATION_NOT_FOUND", "Teacher allocation not found"); await requireBranch(req, old.branchId); const data = { ...old, status }; await validateRelations(req, data, old.id); await ensureUnique(data, old.id); const updated = await allocationWrite(() => prisma.teacherAllocation.update({ where: { id: old.id }, data: { status, updatedById: req.auth!.userId }, select })); await audit(req, status === "ACTIVE" ? "ACTIVATE" : "DEACTIVATE", updated.id); return updated; }
router.patch("/teacher-allocations/:id/activate", async (req: AuthRequest, res) => res.json({ data: await setStatus(req, TeacherAllocationStatus.ACTIVE) }));
router.patch("/teacher-allocations/:id/deactivate", async (req: AuthRequest, res) => res.json({ data: await setStatus(req, TeacherAllocationStatus.INACTIVE) }));
router.delete("/teacher-allocations/:id", async (req: AuthRequest, res) => { const allocationId = id.parse(req.params.id), old = await prisma.teacherAllocation.findUnique({ where: { id: allocationId }, select: { id: true, branchId: true, status: true, subjectId: true, teacherId: true, batchId: true } }); if (!old) throw new AppError(404, "ALLOCATION_NOT_FOUND", "Teacher allocation not found"); await requireBranch(req, old.branchId); if (old.status === TeacherAllocationStatus.ACTIVE) throw new AppError(409, "DEACTIVATE_BEFORE_DELETE", "Deactivate the allocation before deleting it"); const references = await prisma.timetable.count({ where: { teacherId: old.teacherId, batchId: old.batchId, subjectId: old.subjectId } }); if (references) throw new AppError(409, "ALLOCATION_IN_USE", "This allocation has timetable history and cannot be deleted"); await prisma.teacherAllocation.delete({ where: { id: old.id } }); await audit(req, "DELETE", old.id, { subjectId: old.subjectId }); res.status(204).send(); });

export default router;
