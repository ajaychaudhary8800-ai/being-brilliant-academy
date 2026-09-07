import { Role, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { sendEmail } from "../lib/notifications.js";
import { env } from "../config.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";
import { assertCanChangeUserRole, managedUserBranchIds } from "../lib/user-administration-policy.js";
import { assertEligibleParentStudent, assertParentBranchScope, parentRelationships } from "../lib/parent-administration-policy.js";
import { summarizeAdminUser } from "../lib/admin-user-summary.js";

const router = Router();
router.use(requireAuth, allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN));

const relationSchema = z.enum(parentRelationships);
const branchIdsForActor = async (req: AuthRequest) => req.auth!.role === Role.SUPER_ADMIN
  ? null
  : (await prisma.branchUser.findMany({ where: { userId: req.auth!.userId }, select: { branchId: true } })).map(item => item.branchId);

const userSelect = {
  id: true, name: true, email: true, phone: true, role: true, isActive: true, createdAt: true,
  branchAssignments: { select: { branch: { select: { id: true, branchCode: true, branchName: true } } } },
  studentProfile: { select: { id: true, admissionNo: true, status: true, branch: { select: { id: true, branchCode: true, branchName: true } } } },
  teacherProfile: { select: { id: true, employeeNo: true, branch: { select: { id: true, branchCode: true, branchName: true } } } },
  employee: { select: { id: true, branch: { select: { id: true, branchCode: true, branchName: true } } } },
  parentChildren: { select: { relationship: true, student: { select: { id: true, admissionNo: true, status: true, user: { select: { name: true } }, branch: { select: { id: true, branchCode: true, branchName: true } }, batch: { select: { name: true, course: { select: { title: true } } } } } } } },
} as const;

function branchesOf(user: any) { return [...new Set(managedUserBranchIds({ branchAssignments: user.branchAssignments.map((x: any) => ({ branchId: x.branch.id })), studentProfile: user.studentProfile ? { branchId: user.studentProfile.branch.id } : null, teacherProfile: user.teacherProfile ? { branchId: user.teacherProfile.branch.id } : null, employee: user.employee ? { branchId: user.employee.branch.id } : null, parentChildren: user.parentChildren.map((x: any) => ({ student: { branchId: x.student.branch.id } })) }))]; }

async function loadTarget(req: AuthRequest, id: string) {
  const target = await prisma.user.findUnique({ where: { id }, select: userSelect });
  if (!target) throw new AppError(404, "USER_NOT_FOUND", "User not found");
  const allowed = await branchIdsForActor(req); const targetBranches = branchesOf(target);
  if (allowed && (!targetBranches.length || targetBranches.some(branchId => !allowed.includes(branchId)))) throw new AppError(403, "USER_BRANCH_FORBIDDEN", "The user is outside your assigned branch scope");
  return target;
}

function mapUnique(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return null;
  const target = String(error.meta?.target ?? "");
  if (target.includes("email")) return new AppError(409, "EMAIL_EXISTS", "An account already uses this email");
  if (target.includes("phone")) return new AppError(409, "PHONE_EXISTS", "An account already uses this phone");
  if (target.includes("parentId") || target.includes("studentId")) return new AppError(409, "PARENT_STUDENT_EXISTS", "This student is already linked to the parent");
  return new AppError(409, "DUPLICATE_VALUE", "A unique value is already in use");
}

router.get("/users", async (req: AuthRequest, res) => {
  const q = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20), search: z.string().trim().max(100).optional(), role: z.nativeEnum(Role).optional(), branchId: z.string().cuid().optional(), status: z.enum(["active", "inactive"]).optional() }).parse(req.query);
  const allowed = await branchIdsForActor(req);
  if (q.branchId && allowed && !allowed.includes(q.branchId)) throw new AppError(403, "BRANCH_FORBIDDEN", "You do not have access to this branch");
  const branchFilter = q.branchId ? [q.branchId] : allowed;
  const filters: any[] = [];
  if (branchFilter) filters.push({ OR: [{ branchAssignments: { some: { branchId: { in: branchFilter } } } }, { studentProfile: { branchId: { in: branchFilter } } }, { teacherProfile: { branchId: { in: branchFilter } } }, { employee: { branchId: { in: branchFilter } } }, { parentChildren: { some: { student: { branchId: { in: branchFilter } } } } }] });
  if (q.search) filters.push({ OR: [{ name: { contains: q.search, mode: "insensitive" as const } }, { email: { contains: q.search, mode: "insensitive" as const } }, { phone: { contains: q.search, mode: "insensitive" as const } }] });
  const where = { ...(filters.length ? { AND: filters } : {}), ...(q.role ? { role: q.role } : {}), ...(q.status ? { isActive: q.status === "active" } : {}) };
  const [total, data] = await prisma.$transaction([prisma.user.count({ where }), prisma.user.findMany({ where, select: userSelect, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.limit, take: q.limit })]);
  res.json({ data: data.map(summarizeAdminUser), meta: { total, page: q.page, limit: q.limit, totalPages: Math.max(1, Math.ceil(total / q.limit)) } });
});

router.get("/users/students", async (req: AuthRequest, res) => {
  const allowed = await branchIdsForActor(req);
  const data = await prisma.studentProfile.findMany({ where: { status: "ACTIVE", user: { isActive: true }, ...(allowed ? { branchId: { in: allowed } } : {}) }, select: { id: true, admissionNo: true, user: { select: { name: true } }, branch: { select: { id: true, branchName: true } }, batch: { select: { name: true, course: { select: { title: true } } } } }, orderBy: { admissionNo: "asc" }, take: 500 });
  res.json({ data });
});

const parentInput = z.object({ name: z.string().trim().min(2).max(100), email: z.string().trim().toLowerCase().email(), phone: z.string().trim().min(7).max(20).nullable().optional(), isActive: z.boolean().default(true), students: z.array(z.object({ studentId: z.string().cuid(), relationship: relationSchema })).min(1).max(20) });
async function validateStudents(req: AuthRequest, students: Array<{ studentId: string; relationship: string }>) {
  const ids = students.map(x => x.studentId); if (new Set(ids).size !== ids.length) throw new AppError(409, "DUPLICATE_STUDENT", "Select each student only once");
  const records = await prisma.studentProfile.findMany({ where: { id: { in: ids } }, select: { id: true, branchId: true, status: true, user: { select: { isActive: true } } } });
  if (records.length !== ids.length) throw new AppError(422, "INVALID_STUDENT", "Every selected student must be active and eligible");
  records.forEach(student => assertEligibleParentStudent(student));
  const allowed = await branchIdsForActor(req); assertParentBranchScope(allowed, records.map(student => student.branchId));
  return records;
}

async function issueSetup(userId: string, organizationId: string, email: string, name: string) {
  const raw = crypto.randomBytes(32).toString("base64url");
  await prisma.passwordResetToken.deleteMany({ where: { userId, usedAt: null } });
  await prisma.passwordResetToken.create({ data: { userId, tokenHash: crypto.createHash("sha256").update(raw).digest("hex"), expiresAt: new Date(Date.now() + 3600000) } });
  const result = await sendEmail(email, "Set up your Being Brilliant Academy account", `Hello ${name},\n\nUse this secure link within one hour to set your password:\n\n${env.WEB_URL}/reset-password?token=${encodeURIComponent(raw)}`);
  return result;
}

router.post("/users/parents", async (req: AuthRequest, res) => {
  const input = parentInput.parse(req.body); const students = await validateStudents(req, input.students);
  try {
    const result = await prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { name: input.name, email: input.email, phone: input.phone ?? null, isActive: input.isActive, role: Role.PARENT, passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString("base64url"), 12) }, select: { id: true, organizationId: true, name: true, email: true, role: true, isActive: true } });
      await tx.parentStudent.createMany({ data: input.students.map(item => ({ parentId: user.id, studentId: item.studentId, relationship: item.relationship })) });
      await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: "USER_CREATED", entity: "User", entityId: user.id, metadata: { role: Role.PARENT, studentCount: input.students.length } } });
      for (const item of input.students) await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: "PARENT_STUDENT_LINKED", entity: "ParentStudent", entityId: user.id, metadata: { studentId: item.studentId, relationship: item.relationship } } });
      return user;
    });
    let setup: unknown = null; try { setup = await issueSetup(result.id, result.organizationId, result.email, result.name); await prisma.auditLog.create({ data: { actorId: req.auth!.userId, action: "PASSWORD_RESET_REQUESTED", entity: "User", entityId: result.id, metadata: { role: Role.PARENT, delivery: (setup as any)?.skipped ? "SKIPPED" : "SENT" } } }); } catch { setup = { skipped: true, reason: "EMAIL_DELIVERY_FAILED" }; }
    res.status(201).json({ data: { ...result, setup } });
  } catch (error) { const mapped = mapUnique(error); if (mapped) throw mapped; throw error; }
});

router.post("/users/:id/children", async (req: AuthRequest, res) => {
  const parent = await loadTarget(req, String(req.params.id)); if (parent.role !== Role.PARENT) throw new AppError(409, "PARENT_ROLE_REQUIRED", "The selected account is not a Parent");
  const input = z.object({ studentId: z.string().cuid(), relationship: relationSchema }).parse(req.body); await validateStudents(req, [input]);
  try { const link = await prisma.$transaction(async tx => { const created = await tx.parentStudent.create({ data: { parentId: parent.id, studentId: input.studentId, relationship: input.relationship } }); await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: "PARENT_STUDENT_LINKED", entity: "ParentStudent", entityId: parent.id, metadata: { studentId: input.studentId, relationship: input.relationship } } }); return created; }); res.status(201).json({ data: link }); } catch (error) { const mapped = mapUnique(error); if (mapped) throw mapped; throw error; }
});

router.delete("/users/:id/children/:studentId", async (req: AuthRequest, res) => {
  const parent = await loadTarget(req, String(req.params.id)); if (parent.role !== Role.PARENT) throw new AppError(409, "PARENT_ROLE_REQUIRED", "The selected account is not a Parent");
  const student = await prisma.studentProfile.findUnique({ where: { id: String(req.params.studentId) }, select: { id: true, branchId: true } }); if (!student) throw new AppError(404, "STUDENT_NOT_FOUND", "Student not found");
  const link = await prisma.parentStudent.findUnique({ where: { parentId_studentId: { parentId: parent.id, studentId: student.id } } }); if (!link) throw new AppError(404, "LINK_NOT_FOUND", "Parent-student link not found");
  const allowed = await branchIdsForActor(req); if (allowed && !allowed.includes(student.branchId)) throw new AppError(403, "BRANCH_FORBIDDEN", "You do not have access to this branch");
  await prisma.$transaction([prisma.parentStudent.delete({ where: { parentId_studentId: { parentId: parent.id, studentId: student.id } } }), prisma.auditLog.create({ data: { actorId: req.auth!.userId, action: "PARENT_STUDENT_UNLINKED", entity: "ParentStudent", entityId: parent.id, metadata: { studentId: student.id, relationship: link.relationship } } })]); res.status(204).send();
});

router.patch("/users/:id", async (req: AuthRequest, res) => {
  const target = await loadTarget(req, String(req.params.id)); const input = z.object({ name: z.string().trim().min(2).max(100).optional(), email: z.string().trim().toLowerCase().email().optional(), phone: z.string().trim().min(7).max(20).nullable().optional(), isActive: z.boolean().optional(), role: z.nativeEnum(Role).optional() }).parse(req.body);
  if (target.id === req.auth!.userId && (input.role !== undefined || input.isActive === false)) throw new AppError(403, "SELF_ACCOUNT_CHANGE_FORBIDDEN", "You cannot deactivate or change your own account");
  const allowed = await branchIdsForActor(req) ?? []; const managed = { id: target.id, role: target.role, isActive: target.isActive, branchIds: branchesOf(target), hasStudentProfile: Boolean(target.studentProfile), hasTeacherProfile: Boolean(target.teacherProfile), hasEmployeeProfile: Boolean(target.employee), hasParentLinks: target.parentChildren.length > 0 };
  if (input.role && input.role !== target.role) { const count = await prisma.user.count({ where: { role: Role.SUPER_ADMIN, isActive: true } }); assertCanChangeUserRole({ id: req.auth!.userId, role: req.auth!.role, branchIds: allowed }, managed, input.role, count); }
  if ((target.role === Role.SUPER_ADMIN || target.role === Role.BRANCH_ADMIN) && req.auth!.role === Role.BRANCH_ADMIN) throw new AppError(403, "ADMIN_ACCOUNT_PROTECTED", "Administrator accounts are protected");
  try { const data = await prisma.$transaction(async tx => { const updated = await tx.user.update({ where: { id: target.id }, data: { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.email !== undefined ? { email: input.email } : {}), ...(input.phone !== undefined ? { phone: input.phone } : {}), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}), ...(input.role !== undefined ? { role: input.role } : {}) }, select: { id: true, name: true, email: true, phone: true, role: true, isActive: true } }); if (input.isActive !== undefined && input.isActive !== target.isActive) { await tx.session.deleteMany({ where: { userId: target.id } }); await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: "USER_STATUS_CHANGED", entity: "User", entityId: target.id, metadata: { previousStatus: target.isActive, nextStatus: input.isActive } } }); } if (input.role !== undefined && input.role !== target.role) { await tx.session.deleteMany({ where: { userId: target.id } }); await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: "USER_ROLE_CHANGED", entity: "User", entityId: target.id, metadata: { previousRole: target.role, nextRole: input.role } } }); } if (input.name !== undefined || input.email !== undefined || input.phone !== undefined) await tx.auditLog.create({ data: { actorId: req.auth!.userId, action: "USER_UPDATED", entity: "User", entityId: target.id, metadata: { fields: Object.keys(input).filter(key => ["name", "email", "phone"].includes(key)) } } }); return updated; }); res.json({ data }); } catch (error) { const mapped = mapUnique(error); if (mapped) throw mapped; throw error; }
});

router.post("/users/:id/setup-email", async (req: AuthRequest, res) => { const target = await loadTarget(req, String(req.params.id)); try { const result = await issueSetup(target.id, req.auth!.organizationId, target.email, target.name); await prisma.auditLog.create({ data: { actorId: req.auth!.userId, action: "PASSWORD_RESET_REQUESTED", entity: "User", entityId: target.id, metadata: { delivery: result.skipped ? "SKIPPED" : "SENT" } } }); res.status(202).json({ data: { sent: !result.skipped, skipped: result.skipped } }); } catch { throw new AppError(502, "RESET_EMAIL_FAILED", "Unable to send the setup email"); } });

export default router;
