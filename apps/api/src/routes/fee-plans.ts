import crypto from "node:crypto";
import { FeePlanStatus, Prisma, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { assertFinanceBranchAccess, isSerializableConflict, safeFinanceAuditMetadata } from "../lib/finance-integrity.js";
import { AppError } from "../lib/http.js";
import { dateOnly, normalizeFeeHead, planTotalPaise, type FeePlanInput, validatePlanStructure, assertDueDatesWithinSession } from "../lib/fee-plan-integrity.js";
import { prisma } from "../lib/prisma.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN, Role.ACCOUNTANT));
router.use((req: AuthRequest, _res, next) => {
  if (req.auth?.role === Role.ACCOUNTANT && req.method !== "GET") return next(new AppError(403, "ACCOUNTANT_FINANCE_READ_ONLY", "Accountants may only read fee plans"));
  next();
});

const id = z.string().min(1);
const componentInput = z.object({ feeHead: z.string().trim().min(1).max(120), amountPaise: z.number().int().positive(), position: z.number().int().nonnegative().optional() });
const installmentInput = z.object({ sequence: z.number().int().positive(), title: z.string().trim().min(1).max(120), dueDate: z.coerce.date(), components: z.array(componentInput).default([]) });
const planFields = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  academicSessionId: id,
  branchId: id.nullable().optional(),
  courseId: id.nullable().optional(),
  batchId: id.nullable().optional(),
  installments: z.array(installmentInput).default([]),
});
const createInput = planFields.extend({ familyKey: z.string().trim().min(1).max(120).optional() });
const patchInput = planFields.partial();
const planInclude = {
  installments: { orderBy: { sequence: "asc" }, include: { components: { orderBy: { position: "asc" } } } },
  academicSession: { select: { id: true, name: true, startsAt: true, endsAt: true } },
  branch: { select: { id: true, branchName: true, branchCode: true } },
  course: { select: { id: true, title: true, courseCode: true } },
  batch: { select: { id: true, name: true, code: true } },
} as const;

type Db = Prisma.TransactionClient | typeof prisma;
const actorId = (req: AuthRequest) => req.auth!.userId;

async function assignedBranchIds(req: AuthRequest, db: Db = prisma) {
  if (req.auth!.role === Role.SUPER_ADMIN) return null;
  return (await db.branchUser.findMany({ where: { userId: actorId(req), organizationId: req.auth!.organizationId }, select: { branchId: true } })).map(item => item.branchId);
}

function scopedWhere(req: AuthRequest, branchIds: string[] | null) {
  if (req.auth!.role === Role.SUPER_ADMIN) return { organizationId: req.auth!.organizationId };
  if (!branchIds?.length) return { organizationId: req.auth!.organizationId, branchId: { in: [] as string[] } };
  return { organizationId: req.auth!.organizationId, OR: [{ branchId: null }, { branchId: { in: branchIds } }] };
}

function assertMutationBranch(req: AuthRequest, branchIds: string[] | null, branchId: string | null | undefined) {
  if (req.auth!.role === Role.BRANCH_ADMIN && (!branchId || !branchIds?.includes(branchId))) throw new AppError(403, "BRANCH_FORBIDDEN", "Branch Admin fee plans must target an assigned branch");
  if (branchId) assertFinanceBranchAccess(req.auth!.role, branchIds ?? [], branchId);
}

async function audit(db: Db, req: AuthRequest, action: string, entityId: string, metadata: object) {
  await db.auditLog.create({ data: { organizationId: req.auth!.organizationId, actorId: actorId(req), action, entity: "FeePlan", entityId, metadata: safeFinanceAuditMetadata(metadata) } });
}

function mapInput(input: z.infer<typeof planFields>): FeePlanInput {
  return {
    ...input,
    branchId: input.branchId ?? null,
    courseId: input.courseId ?? null,
    batchId: input.batchId ?? null,
    installments: input.installments.map(item => ({ ...item, dueDate: dateOnly(item.dueDate), components: item.components.map(component => ({ ...component, position: component.position ?? 0 })) })),
  };
}

async function validateRelationships(db: Db, req: AuthRequest, input: FeePlanInput, branchIds: string[] | null) {
  assertMutationBranch(req, branchIds, input.branchId);
  const session = await db.academicSession.findFirst({ where: { id: input.academicSessionId, organizationId: req.auth!.organizationId }, select: { id: true, startsAt: true, endsAt: true, isArchived: true } });
  if (!session) throw new AppError(422, "INVALID_ACADEMIC_SESSION", "Select a valid academic session");
  if (session.isArchived) throw new AppError(409, "ACADEMIC_SESSION_ARCHIVED", "Archived academic sessions cannot receive a fee plan");
  assertDueDatesWithinSession(input.installments, session.startsAt, session.endsAt);
  if (input.branchId) {
    const branch = await db.branch.findFirst({ where: { id: input.branchId, organizationId: req.auth!.organizationId }, select: { id: true } });
    if (!branch) throw new AppError(422, "INVALID_BRANCH", "Select a valid branch");
  }
  if (input.courseId) {
    const course = await db.course.findFirst({ where: { id: input.courseId, organizationId: req.auth!.organizationId }, select: { id: true, branchId: true } });
    if (!course || (course.branchId && (!input.branchId || course.branchId !== input.branchId))) throw new AppError(422, "INVALID_COURSE", "Course is not available for the selected branch");
  }
  if (input.batchId) {
    const batch = await db.batch.findFirst({ where: { id: input.batchId, organizationId: req.auth!.organizationId }, select: { id: true, branchId: true, courseId: true, academicSessionId: true } });
    if (!batch || batch.academicSessionId !== input.academicSessionId || !input.branchId || batch.branchId !== input.branchId || (input.courseId && batch.courseId !== input.courseId)) throw new AppError(422, "INVALID_BATCH", "Batch must match the selected academic session, branch and course");
  }
  return session;
}

function payload(plan: any) {
  const installments = (plan.installments ?? []).map((installment: any) => ({
    id: installment.id,
    sequence: installment.sequence,
    title: installment.title,
    dueDate: installment.dueDate,
    totalPaise: installment.components.reduce((sum: number, component: any) => sum + component.amountPaise, 0),
    components: installment.components.map((component: any) => ({ id: component.id, feeHead: component.feeHead, amountPaise: component.amountPaise, position: component.position })),
  }));
  return { ...plan, installments, planTotalPaise: installments.reduce((sum: number, item: any) => sum + item.totalPaise, 0) };
}

async function findPlan(req: AuthRequest, planId: string) {
  const branchIds = await assignedBranchIds(req);
  const plan = await prisma.feePlan.findFirst({ where: { id: planId, ...scopedWhere(req, branchIds) }, include: planInclude });
  if (!plan) throw new AppError(404, "FEE_PLAN_NOT_FOUND", "Fee plan not found");
  return plan;
}

async function writeChildren(db: Db, organizationId: string, planId: string, installments: FeePlanInput["installments"]) {
  for (const installment of installments) {
    const created = await db.feePlanInstallment.create({ data: { organizationId, planId, sequence: installment.sequence, title: installment.title, dueDate: installment.dueDate } });
    for (const component of installment.components) await db.feePlanComponent.create({ data: { organizationId, installmentId: created.id, feeHead: component.feeHead.trim().replace(/\s+/g, " "), normalizedFeeHead: normalizeFeeHead(component.feeHead), amountPaise: component.amountPaise, position: component.position ?? 0 } });
  }
}

async function serializable<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
  try { return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
  catch (error) {
    if (isSerializableConflict(error)) throw new AppError(409, "FEE_PLAN_CONFLICT", "The fee plan changed concurrently; reload and try again");
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002") throw new AppError(409, "FEE_PLAN_EXISTS", "A fee plan with the same version or applicability already exists");
    throw error;
  }
}

router.get("/finance/fee-plans", async (req: AuthRequest, res) => {
  const query = z.object({ status: z.nativeEnum(FeePlanStatus).optional(), academicSessionId: id.optional(), branchId: id.optional() }).parse(req.query);
  const branchIds = await assignedBranchIds(req);
  if (query.branchId && req.auth!.role !== Role.SUPER_ADMIN && !branchIds?.includes(query.branchId)) throw new AppError(403, "BRANCH_FORBIDDEN", "Branch access denied");
  const data = await prisma.feePlan.findMany({ where: { ...scopedWhere(req, branchIds), ...(query.status ? { status: query.status } : {}), ...(query.academicSessionId ? { academicSessionId: query.academicSessionId } : {}), ...(query.branchId ? { branchId: query.branchId } : {}) }, include: planInclude, orderBy: [{ familyKey: "asc" }, { version: "desc" }] });
  res.json({ data: data.map(payload) });
});

router.post("/finance/fee-plans", async (req: AuthRequest, res) => {
  const raw = createInput.parse(req.body);
  const input = mapInput(raw);
  validatePlanStructure(input);
  const branchIds = await assignedBranchIds(req);
  const created = await serializable(async tx => {
    await validateRelationships(tx, req, input, branchIds);
    const plan = await tx.feePlan.create({ data: { organizationId: req.auth!.organizationId, familyKey: raw.familyKey ?? crypto.randomUUID(), code: raw.code, name: raw.name, version: 1, status: FeePlanStatus.DRAFT, academicSessionId: raw.academicSessionId, branchId: raw.branchId ?? null, courseId: raw.courseId ?? null, batchId: raw.batchId ?? null, createdById: actorId(req) } });
    await writeChildren(tx, req.auth!.organizationId, plan.id, input.installments);
    await audit(tx, req, "FEE_PLAN_CREATED", plan.id, { familyKey: plan.familyKey, version: plan.version, status: plan.status, planTotalPaise: planTotalPaise(input.installments) });
    return tx.feePlan.findUnique({ where: { id: plan.id }, include: planInclude });
  });
  res.status(201).json({ data: payload(created) });
});

router.get("/finance/fee-plans/:id", async (req: AuthRequest, res) => res.json({ data: payload(await findPlan(req, String(req.params.id))) }));

router.patch("/finance/fee-plans/:id", async (req: AuthRequest, res) => {
  const patch = patchInput.parse(req.body);
  const branchIds = await assignedBranchIds(req);
  const updated = await serializable(async tx => {
    const current = await tx.feePlan.findFirst({ where: { id: String(req.params.id), ...scopedWhere(req, branchIds) }, include: { installments: { include: { components: true } } } });
    if (!current) throw new AppError(404, "FEE_PLAN_NOT_FOUND", "Fee plan not found");
    assertMutationBranch(req, branchIds, current.branchId);
    if (current.status !== FeePlanStatus.DRAFT) throw new AppError(409, "FEE_PLAN_IMMUTABLE", "Only draft fee plans can be edited");
    const merged = mapInput({ code: patch.code ?? current.code, name: patch.name ?? current.name, academicSessionId: patch.academicSessionId ?? current.academicSessionId, branchId: patch.branchId === undefined ? current.branchId : patch.branchId, courseId: patch.courseId === undefined ? current.courseId : patch.courseId, batchId: patch.batchId === undefined ? current.batchId : patch.batchId, installments: patch.installments ?? current.installments.map(item => ({ sequence: item.sequence, title: item.title, dueDate: item.dueDate, components: item.components.map(component => ({ feeHead: component.feeHead, amountPaise: component.amountPaise, position: component.position })) })) });
    validatePlanStructure(merged);
    await validateRelationships(tx, req, merged, branchIds);
    const plan = await tx.feePlan.update({ where: { id: current.id }, data: { code: merged.code, name: merged.name, academicSessionId: merged.academicSessionId, branchId: merged.branchId, courseId: merged.courseId, batchId: merged.batchId } });
    if (patch.installments !== undefined) {
      await tx.feePlanComponent.deleteMany({ where: { installment: { planId: plan.id } } });
      await tx.feePlanInstallment.deleteMany({ where: { planId: plan.id } });
      await writeChildren(tx, req.auth!.organizationId, plan.id, merged.installments);
    }
    await audit(tx, req, "FEE_PLAN_UPDATED", plan.id, { changedFields: Object.keys(patch), planTotalPaise: planTotalPaise(merged.installments) });
    return tx.feePlan.findUnique({ where: { id: plan.id }, include: planInclude });
  });
  res.json({ data: payload(updated) });
});

router.post("/finance/fee-plans/:id/activate", async (req: AuthRequest, res) => {
  const branchIds = await assignedBranchIds(req);
  const activated = await serializable(async tx => {
    const current = await tx.feePlan.findFirst({ where: { id: String(req.params.id), ...scopedWhere(req, branchIds) }, include: { installments: { include: { components: true } } } });
    if (!current) throw new AppError(404, "FEE_PLAN_NOT_FOUND", "Fee plan not found");
    if (current.status !== FeePlanStatus.DRAFT) throw new AppError(409, "FEE_PLAN_IMMUTABLE", "Only draft fee plans can be activated");
    const input = { code: current.code, name: current.name, academicSessionId: current.academicSessionId, branchId: current.branchId, courseId: current.courseId, batchId: current.batchId, installments: current.installments.map(item => ({ sequence: item.sequence, title: item.title, dueDate: item.dueDate, components: item.components.map(component => ({ feeHead: component.feeHead, amountPaise: component.amountPaise, position: component.position })) })) } satisfies FeePlanInput;
    validatePlanStructure(input, true);
    await validateRelationships(tx, req, input, branchIds);
    await tx.feePlan.updateMany({ where: { organizationId: req.auth!.organizationId, familyKey: current.familyKey, academicSessionId: current.academicSessionId, branchId: current.branchId, courseId: current.courseId, batchId: current.batchId, status: FeePlanStatus.ACTIVE, id: { not: current.id } }, data: { status: FeePlanStatus.INACTIVE } });
    await tx.feePlan.update({ where: { id: current.id }, data: { status: FeePlanStatus.ACTIVE } });
    await audit(tx, req, "FEE_PLAN_ACTIVATED", current.id, { familyKey: current.familyKey, version: current.version, planTotalPaise: planTotalPaise(input.installments) });
    return tx.feePlan.findUnique({ where: { id: current.id }, include: planInclude });
  });
  res.json({ data: payload(activated) });
});

router.post("/finance/fee-plans/:id/archive", async (req: AuthRequest, res) => {
  const branchIds = await assignedBranchIds(req);
  const archived = await serializable(async tx => {
    const current = await tx.feePlan.findFirst({ where: { id: String(req.params.id), organizationId: req.auth!.organizationId } });
    if (!current) throw new AppError(404, "FEE_PLAN_NOT_FOUND", "Fee plan not found");
    assertMutationBranch(req, branchIds, current.branchId);
    if (current.status === FeePlanStatus.ACTIVE) throw new AppError(409, "FEE_PLAN_IMMUTABLE", "Active fee plans must be made inactive before archiving");
    if (current.status === FeePlanStatus.ARCHIVED) throw new AppError(409, "FEE_PLAN_IMMUTABLE", "Fee plan is already archived");
    const result = await tx.feePlan.update({ where: { id: current.id }, data: { status: FeePlanStatus.ARCHIVED } });
    await audit(tx, req, "FEE_PLAN_ARCHIVED", result.id, { familyKey: result.familyKey, version: result.version });
    return tx.feePlan.findUnique({ where: { id: result.id }, include: planInclude });
  });
  res.json({ data: payload(archived) });
});

router.post("/finance/fee-plans/:id/new-version", async (req: AuthRequest, res) => {
  const branchIds = await assignedBranchIds(req);
  const created = await serializable(async tx => {
    const source = await tx.feePlan.findFirst({ where: { id: String(req.params.id), organizationId: req.auth!.organizationId }, include: { installments: { orderBy: { sequence: "asc" }, include: { components: { orderBy: { position: "asc" } } } } } });
    if (!source) throw new AppError(404, "FEE_PLAN_NOT_FOUND", "Fee plan not found");
    assertMutationBranch(req, branchIds, source.branchId);
    if (source.status === FeePlanStatus.ARCHIVED) throw new AppError(409, "FEE_PLAN_IMMUTABLE", "Archived fee plans cannot create a new version");
    const input = { code: source.code, name: source.name, academicSessionId: source.academicSessionId, branchId: source.branchId, courseId: source.courseId, batchId: source.batchId, installments: source.installments.map(item => ({ sequence: item.sequence, title: item.title, dueDate: item.dueDate, components: item.components.map(component => ({ feeHead: component.feeHead, amountPaise: component.amountPaise, position: component.position })) })) } satisfies FeePlanInput;
    validatePlanStructure(input, false);
    await validateRelationships(tx, req, input, branchIds);
    const latest = await tx.feePlan.findFirst({ where: { organizationId: req.auth!.organizationId, familyKey: source.familyKey }, orderBy: { version: "desc" }, select: { version: true } });
    const version = (latest?.version ?? source.version) + 1;
    const plan = await tx.feePlan.create({ data: { organizationId: req.auth!.organizationId, familyKey: source.familyKey, code: source.code, name: source.name, version, status: FeePlanStatus.DRAFT, academicSessionId: source.academicSessionId, branchId: source.branchId, courseId: source.courseId, batchId: source.batchId, supersedesId: source.id, createdById: actorId(req) } });
    await writeChildren(tx, req.auth!.organizationId, plan.id, source.installments.map(item => ({ sequence: item.sequence, title: item.title, dueDate: item.dueDate, components: item.components.map(component => ({ feeHead: component.feeHead, amountPaise: component.amountPaise, position: component.position })) })));
    await audit(tx, req, "FEE_PLAN_VERSION_CREATED", plan.id, { familyKey: plan.familyKey, version: plan.version, supersedesId: source.id });
    return tx.feePlan.findUnique({ where: { id: plan.id }, include: planInclude });
  });
  res.status(201).json({ data: payload(created) });
});

export default router;
