import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN));

const studentSelect = {
  id: true,
  admissionNo: true,
  fatherName: true,
  className: true,
  user: { select: { id: true, name: true, email: true, phone: true, avatarUrl: true, isActive: true } },
  branch: { select: { id: true, branchName: true } },
  batch: { select: { id: true, name: true } },
} as const;

const studentInput = z.object({
  admissionNo: z.string().trim().min(3).max(40),
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128).optional(),
  fatherName: z.string().trim().min(2).max(100),
  className: z.string().trim().min(2).max(50),
  branchId: z.string().cuid(),
  batchId: z.string().cuid().nullable().optional(),
  mobile: z.string().trim().min(7).max(20).nullable().optional(),
  photoUrl: z.string().url().nullable().optional(),
  isActive: z.boolean().optional(),
});

const studentQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().optional(),
  branchId: z.string().cuid().optional(),
  className: z.string().trim().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  sortBy: z.enum(["admissionNo", "name", "className", "createdAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

async function branchScope(req: AuthRequest) {
  if (req.auth!.role !== Role.BRANCH_ADMIN) return null;
  const assignments = await prisma.branchUser.findMany({ where: { userId: req.auth!.userId }, select: { branchId: true } });
  return assignments.map((item) => item.branchId);
}

async function requireBranchAccess(req: AuthRequest, branchId: string) {
  const allowed = await branchScope(req);
  if (allowed && !allowed.includes(branchId)) throw new AppError(403, "BRANCH_FORBIDDEN", "You do not have access to this branch");
}

function branchWithLegacyLabels<T extends { id: string; branchName: string; branchCode?: string }>(branch: T) {
  return { ...branch, name: branch.branchName, ...(branch.branchCode ? { code: branch.branchCode } : {}) };
}
function studentWithLegacyBranch<T extends { branch: { id: string; branchName: string } }>(student: T) {
  return { ...student, branch: branchWithLegacyLabels(student.branch) };
}
function teacherWithLegacyBranch<T extends { branch: { id: string; branchName: string; branchCode: string } }>(teacher: T) {
  return { ...teacher, branch: branchWithLegacyLabels(teacher.branch) };
}

router.get("/overview", async (_req, res) => {
  const [students, courses, paid, active, totalBranches, activeBranches] = await Promise.all([
    prisma.user.count({ where: { role: Role.STUDENT } }),
    prisma.course.count(),
    prisma.invoice.aggregate({ where: { status: "PAID" }, _sum: { amount: true } }),
    prisma.enrollment.count({ where: { status: "ACTIVE" } }),
    prisma.branch.count(),
    prisma.branch.count({ where: { isActive: true } }),
  ]);
  res.json({ data: { students, courses, activeEnrollments: active, revenuePaise: paid._sum.amount ?? 0, totalBranches, activeBranches, inactiveBranches: totalBranches - activeBranches } });
});

router.get("/users", async (_req, res) => {
  const data = await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 100 });
  res.json({ data });
});

router.patch("/users/:id/role", async (req, res) => {
  const role = z.object({ role: z.nativeEnum(Role) }).parse(req.body).role;
  const data = await prisma.user.update({ where: { id: String(req.params.id) }, data: { role }, select: { id: true, role: true } });
  res.json({ data });
});

const branchSelect = { id: true, branchCode: true, branchName: true, address: true, city: true, state: true, pincode: true, phone: true, email: true, managerName: true, openingDate: true, isActive: true, createdAt: true, updatedAt: true, _count: { select: { students: true, teachers: true, batches: true } } } as const;
const branchInput = z.object({ branchCode: z.string().trim().min(2).max(30).regex(/^[A-Z0-9-]+$/i, "Use letters, numbers and hyphens only"), branchName: z.string().trim().min(2).max(120), address: z.string().trim().min(5).max(500), city: z.string().trim().min(2).max(80), state: z.string().trim().min(2).max(80), pincode: z.string().trim().regex(/^\d{6}$/, "Enter a valid 6-digit pincode"), phone: z.string().trim().regex(/^\+?[0-9 -]{7,20}$/, "Enter a valid phone number"), email: z.string().trim().toLowerCase().email(), managerName: z.string().trim().min(2).max(100), openingDate: z.coerce.date(), isActive: z.boolean().optional() });
const branchQuery = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(10), search: z.string().trim().optional(), status: z.enum(["active", "inactive"]).optional(), sortBy: z.enum(["branchCode", "branchName", "city", "createdAt", "openingDate"]).default("createdAt"), sortOrder: z.enum(["asc", "desc"]).default("desc") });

router.get("/branches", async (req: AuthRequest, res) => {
  const query = branchQuery.parse(req.query); const allowed = await branchScope(req);
  const where = { ...(allowed ? { id: { in: allowed } } : {}), ...(query.status ? { isActive: query.status === "active" } : {}), ...(query.search ? { OR: [{ branchName: { contains: query.search, mode: "insensitive" as const } }, { branchCode: { contains: query.search, mode: "insensitive" as const } }, { city: { contains: query.search, mode: "insensitive" as const } }] } : {}) };
  const [total, data] = await prisma.$transaction([prisma.branch.count({ where }), prisma.branch.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: { [query.sortBy]: query.sortOrder }, select: branchSelect })]);
  res.json({ data: data.map(branchWithLegacyLabels), meta: { total, page: query.page, limit: query.limit, totalPages: Math.max(1, Math.ceil(total / query.limit)) } });
});
router.get("/branches/:id", async (req: AuthRequest, res) => { const data = await prisma.branch.findUnique({ where: { id: String(req.params.id) }, select: branchSelect }); if (!data) throw new AppError(404, "BRANCH_NOT_FOUND", "Branch not found"); await requireBranchAccess(req, data.id); res.json({ data: branchWithLegacyLabels(data) }); });
router.post("/branches", async (req: AuthRequest, res) => { const input = branchInput.parse(req.body); const data = await prisma.branch.create({ data: { ...input, isActive: input.isActive ?? true }, select: branchSelect }); res.status(201).json({ data: branchWithLegacyLabels(data) }); });
router.put("/branches/:id", async (req: AuthRequest, res) => { const input = branchInput.partial().parse(req.body); const existing = await prisma.branch.findUnique({ where: { id: String(req.params.id) }, select: { id: true } }); if (!existing) throw new AppError(404, "BRANCH_NOT_FOUND", "Branch not found"); await requireBranchAccess(req, existing.id); const data = await prisma.branch.update({ where: { id: existing.id }, data: input, select: branchSelect }); res.json({ data: branchWithLegacyLabels(data) }); });
router.patch("/branches/:id/status", async (req: AuthRequest, res) => { const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body); const existing = await prisma.branch.findUnique({ where: { id: String(req.params.id) }, select: { id: true } }); if (!existing) throw new AppError(404, "BRANCH_NOT_FOUND", "Branch not found"); await requireBranchAccess(req, existing.id); const data = await prisma.branch.update({ where: { id: existing.id }, data: { isActive }, select: branchSelect }); res.json({ data: branchWithLegacyLabels(data) }); });
router.delete("/branches/:id", async (req: AuthRequest, res) => { const existing = await prisma.branch.findUnique({ where: { id: String(req.params.id) }, select: { id: true, _count: { select: { students: true, teachers: true, batches: true, teacherAllocations: true } } } }); if (!existing) throw new AppError(404, "BRANCH_NOT_FOUND", "Branch not found"); await requireBranchAccess(req, existing.id); if (existing._count.students || existing._count.teachers || existing._count.batches || existing._count.teacherAllocations) throw new AppError(409, "BRANCH_IN_USE", "Move students, teachers, batches and teacher allocations before deleting this branch"); await prisma.branch.delete({ where: { id: existing.id } }); res.status(204).send(); });

router.get("/students", async (req: AuthRequest, res) => {
  const query = studentQuery.parse(req.query);
  const allowed = await branchScope(req);
  if (query.branchId) await requireBranchAccess(req, query.branchId);
  const where = {
    ...(allowed ? { branchId: { in: allowed } } : {}),
    ...(query.branchId ? { branchId: query.branchId } : {}),
    ...(query.className ? { className: query.className } : {}),
    ...(query.status ? { user: { isActive: query.status === "active" } } : {}),
    ...(query.search ? { OR: [
      { admissionNo: { contains: query.search, mode: "insensitive" as const } },
      { fatherName: { contains: query.search, mode: "insensitive" as const } },
      { user: { name: { contains: query.search, mode: "insensitive" as const } } },
      { user: { phone: { contains: query.search, mode: "insensitive" as const } } },
    ] } : {}),
  };
  const orderBy = query.sortBy === "name" ? { user: { name: query.sortOrder } } : { [query.sortBy]: query.sortOrder };
  const [total, data] = await prisma.$transaction([
    prisma.studentProfile.count({ where }),
    prisma.studentProfile.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy, select: studentSelect }),
  ]);
  res.json({ data: data.map(studentWithLegacyBranch), meta: { total, page: query.page, limit: query.limit, totalPages: Math.max(1, Math.ceil(total / query.limit)) } });
});

router.get("/students/:id", async (req: AuthRequest, res) => {
  const data = await prisma.studentProfile.findUnique({ where: { id: String(req.params.id) }, select: studentSelect });
  if (!data) throw new AppError(404, "STUDENT_NOT_FOUND", "Student not found");
  await requireBranchAccess(req, data.branch.id);
  res.json({ data: studentWithLegacyBranch(data) });
});

router.post("/students", async (req: AuthRequest, res) => {
  const input = studentInput.extend({ password: z.string().min(8).max(128) }).parse(req.body);
  await requireBranchAccess(req, input.branchId);
  if (input.batchId) { const batch = await prisma.batch.findUnique({ where: { id: input.batchId }, select: { branchId: true } }); if (!batch || batch.branchId !== input.branchId) throw new AppError(422, "INVALID_BATCH", "Select a batch from the selected branch"); }
  const data = await prisma.studentProfile.create({ data: { admissionNo: input.admissionNo, fatherName: input.fatherName, className: input.className, branch: { connect: { id: input.branchId } }, ...(input.batchId ? { batch: { connect: { id: input.batchId } } } : {}), user: { create: { name: input.name, email: input.email, phone: input.mobile ?? null, avatarUrl: input.photoUrl ?? null, passwordHash: await bcrypt.hash(input.password, 12), role: Role.STUDENT, isActive: input.isActive ?? true } } } as any, select: studentSelect });
  res.status(201).json({ data: studentWithLegacyBranch(data) });
});

router.patch("/students/:id", async (req: AuthRequest, res) => {
  const input = studentInput.partial().parse(req.body);
  const existing = await prisma.studentProfile.findUnique({ where: { id: String(req.params.id) }, select: { id: true, branchId: true, userId: true } });
  if (!existing) throw new AppError(404, "STUDENT_NOT_FOUND", "Student not found");
  await requireBranchAccess(req, existing.branchId);
  if (input.branchId) await requireBranchAccess(req, input.branchId);
  const branchId = input.branchId ?? existing.branchId;
  if (input.batchId) { const batch = await prisma.batch.findUnique({ where: { id: input.batchId }, select: { branchId: true } }); if (!batch || batch.branchId !== branchId) throw new AppError(422, "INVALID_BATCH", "Select a batch from the selected branch"); }
  const data = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: existing.userId }, data: { ...(input.name ? { name: input.name } : {}), ...(input.email ? { email: input.email } : {}), ...(input.mobile !== undefined ? { phone: input.mobile } : {}), ...(input.photoUrl !== undefined ? { avatarUrl: input.photoUrl } : {}), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}), ...(input.password ? { passwordHash: await bcrypt.hash(input.password, 12) } : {}) } });
    return tx.studentProfile.update({ where: { id: existing.id }, data: { ...(input.admissionNo ? { admissionNo: input.admissionNo } : {}), ...(input.fatherName ? { fatherName: input.fatherName } : {}), ...(input.className ? { className: input.className } : {}), ...(input.branchId ? { branchId: input.branchId } : {}), ...(input.batchId !== undefined ? { batchId: input.batchId } : {}) } as any, select: studentSelect });
  });
  res.json({ data: studentWithLegacyBranch(data) });
});

router.patch("/students/:id/status", async (req: AuthRequest, res) => {
  const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);
  const student = await prisma.studentProfile.findUnique({ where: { id: String(req.params.id) }, select: { userId: true, branchId: true } });
  if (!student) throw new AppError(404, "STUDENT_NOT_FOUND", "Student not found");
  await requireBranchAccess(req, student.branchId);
  await prisma.user.update({ where: { id: student.userId }, data: { isActive } });
  res.status(204).send();
});

router.delete("/students/:id", async (req: AuthRequest, res) => {
  const student = await prisma.studentProfile.findUnique({ where: { id: String(req.params.id) }, select: { id: true, userId: true, branchId: true } });
  if (!student) throw new AppError(404, "STUDENT_NOT_FOUND", "Student not found");
  await requireBranchAccess(req, student.branchId);
  await prisma.$transaction([prisma.studentProfile.delete({ where: { id: student.id } }), prisma.user.delete({ where: { id: student.userId } })]);
  res.status(204).send();
});

const teacherSelect = { id: true, employeeNo: true, qualification: true, specialization: true, user: { select: { id: true, name: true, email: true, phone: true, avatarUrl: true, isActive: true } }, branch: { select: { id: true, branchName: true, branchCode: true } } } as const;
const teacherInput = z.object({ employeeNo: z.string().trim().min(3).max(40), name: z.string().trim().min(2).max(100), email: z.string().trim().toLowerCase().email(), password: z.string().min(8).max(128).optional(), mobile: z.string().trim().min(7).max(20).nullable().optional(), photoUrl: z.string().url().nullable().optional(), qualification: z.string().trim().max(150).nullable().optional(), specialization: z.string().trim().max(150).nullable().optional(), branchId: z.string().cuid(), isActive: z.boolean().optional() });
const teacherQuery = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(10), search: z.string().trim().optional(), branchId: z.string().cuid().optional(), specialization: z.string().trim().optional(), status: z.enum(["active", "inactive"]).optional(), sortBy: z.enum(["employeeNo", "name", "specialization", "createdAt"]).default("createdAt"), sortOrder: z.enum(["asc", "desc"]).default("desc") });

router.get("/teachers", async (req: AuthRequest, res) => {
  const query = teacherQuery.parse(req.query); const allowed = await branchScope(req); if (query.branchId) await requireBranchAccess(req, query.branchId);
  const where = { ...(allowed ? { branchId: { in: allowed } } : {}), ...(query.branchId ? { branchId: query.branchId } : {}), ...(query.specialization ? { specialization: query.specialization } : {}), ...(query.status ? { user: { isActive: query.status === "active" } } : {}), ...(query.search ? { OR: [{ employeeNo: { contains: query.search, mode: "insensitive" as const } }, { specialization: { contains: query.search, mode: "insensitive" as const } }, { user: { name: { contains: query.search, mode: "insensitive" as const } } }, { user: { phone: { contains: query.search, mode: "insensitive" as const } } }] } : {}) };
  const orderBy = query.sortBy === "name" ? { user: { name: query.sortOrder } } : { [query.sortBy]: query.sortOrder };
  const [total, data] = await prisma.$transaction([prisma.teacherProfile.count({ where }), prisma.teacherProfile.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy, select: teacherSelect })]);
  res.json({ data: data.map(teacherWithLegacyBranch), meta: { total, page: query.page, limit: query.limit, totalPages: Math.max(1, Math.ceil(total / query.limit)) } });
});
router.get("/teachers/:id", async (req: AuthRequest, res) => { const data = await prisma.teacherProfile.findUnique({ where: { id: String(req.params.id) }, select: teacherSelect }); if (!data) throw new AppError(404, "TEACHER_NOT_FOUND", "Teacher not found"); await requireBranchAccess(req, data.branch.id); res.json({ data: teacherWithLegacyBranch(data) }); });
router.post("/teachers", async (req: AuthRequest, res) => { const input = teacherInput.extend({ password: z.string().min(8).max(128) }).parse(req.body); await requireBranchAccess(req, input.branchId); const data = await prisma.teacherProfile.create({ data: { employeeNo: input.employeeNo, qualification: input.qualification ?? null, specialization: input.specialization ?? null, branch: { connect: { id: input.branchId } }, user: { create: { name: input.name, email: input.email, passwordHash: await bcrypt.hash(input.password, 12), phone: input.mobile ?? null, avatarUrl: input.photoUrl ?? null, isActive: input.isActive ?? true, role: Role.TEACHER } } }, select: teacherSelect }); res.status(201).json({ data: teacherWithLegacyBranch(data) }); });
router.patch("/teachers/:id", async (req: AuthRequest, res) => { const input = teacherInput.partial().parse(req.body); const existing = await prisma.teacherProfile.findUnique({ where: { id: String(req.params.id) }, select: { id: true, userId: true, branchId: true } }); if (!existing) throw new AppError(404, "TEACHER_NOT_FOUND", "Teacher not found"); await requireBranchAccess(req, existing.branchId); if (input.branchId) await requireBranchAccess(req, input.branchId); const data = await prisma.$transaction(async tx => { await tx.user.update({ where: { id: existing.userId }, data: { ...(input.name ? { name: input.name } : {}), ...(input.email ? { email: input.email } : {}), ...(input.mobile !== undefined ? { phone: input.mobile } : {}), ...(input.photoUrl !== undefined ? { avatarUrl: input.photoUrl } : {}), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}), ...(input.password ? { passwordHash: await bcrypt.hash(input.password, 12) } : {}) } }); return tx.teacherProfile.update({ where: { id: existing.id }, data: { ...(input.employeeNo ? { employeeNo: input.employeeNo } : {}), ...(input.qualification !== undefined ? { qualification: input.qualification } : {}), ...(input.specialization !== undefined ? { specialization: input.specialization } : {}), ...(input.branchId ? { branchId: input.branchId } : {}) }, select: teacherSelect }); }); res.json({ data: teacherWithLegacyBranch(data) }); });
router.patch("/teachers/:id/status", async (req: AuthRequest, res) => { const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body); const teacher = await prisma.teacherProfile.findUnique({ where: { id: String(req.params.id) }, select: { userId: true, branchId: true } }); if (!teacher) throw new AppError(404, "TEACHER_NOT_FOUND", "Teacher not found"); await requireBranchAccess(req, teacher.branchId); await prisma.user.update({ where: { id: teacher.userId }, data: { isActive } }); res.status(204).send(); });
router.delete("/teachers/:id", async (req: AuthRequest, res) => { const teacher = await prisma.teacherProfile.findUnique({ where: { id: String(req.params.id) }, select: { id: true, userId: true, branchId: true, _count: { select: { allocations: true } } } }); if (!teacher) throw new AppError(404, "TEACHER_NOT_FOUND", "Teacher not found"); await requireBranchAccess(req, teacher.branchId); if (teacher._count.allocations) throw new AppError(409, "TEACHER_HAS_ALLOCATIONS", "Deactivate or remove teacher allocations before deleting this teacher"); await prisma.$transaction([prisma.teacherProfile.delete({ where: { id: teacher.id } }), prisma.user.delete({ where: { id: teacher.userId } })]); res.status(204).send(); });

export default router;
