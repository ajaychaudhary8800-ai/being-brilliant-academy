import { FeePlanStatus, Prisma, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { assertFinanceBranchAccess, feeStatus, isSerializableConflict, safeFinanceAuditMetadata } from "../lib/finance-integrity.js";
import { AppError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN, Role.ACCOUNTANT));
router.use((req: AuthRequest, _res, next) => {
  if (req.auth?.role === Role.ACCOUNTANT && req.method !== "GET") return next(new AppError(403, "ACCOUNTANT_FINANCE_READ_ONLY", "Accountants may only read fee assignments"));
  next();
});

const id = z.string().min(1);
const createInput = z.object({ studentId: id, feePlanId: id }).strict();
const assignmentInclude = {
  feePlan: { select: { id: true, familyKey: true, version: true, code: true, name: true, status: true } },
  academicSession: { select: { id: true, name: true } },
  branch: { select: { id: true, branchCode: true, branchName: true } },
  batch: { select: { id: true, code: true, name: true } },
  assignedBy: { select: { id: true, name: true } },
  fees: { select: { id: true, studentId: true, branchId: true, courseId: true, batchId: true, feeHead: true, totalPaise: true, dueDate: true, status: true, studentFeeAssignmentId: true, feePlanComponentId: true }, orderBy: [{ dueDate: "asc" as const }, { id: "asc" as const }] },
} satisfies Prisma.StudentFeeAssignmentInclude;

type Db = Prisma.TransactionClient | typeof prisma;

async function assignedBranchIds(req: AuthRequest, db: Db = prisma) {
  if (req.auth!.role === Role.SUPER_ADMIN) return null;
  return (await db.branchUser.findMany({ where: { userId: req.auth!.userId, organizationId: req.auth!.organizationId }, select: { branchId: true } })).map(item => item.branchId);
}

function assignmentScope(req: AuthRequest, branchIds: string[] | null) {
  if (req.auth!.role === Role.SUPER_ADMIN) return { organizationId: req.auth!.organizationId };
  return { organizationId: req.auth!.organizationId, branchId: { in: branchIds ?? [] } };
}

function payload(assignment: any) {
  const generatedFees = assignment.fees ?? [];
  return {
    id: assignment.id,
    studentId: assignment.studentId,
    feePlanId: assignment.feePlanId,
    feePlanFamilyKey: assignment.feePlanFamilyKey,
    feePlan: assignment.feePlan,
    academicSessionId: assignment.academicSessionId,
    academicSession: assignment.academicSession,
    branchId: assignment.branchId,
    branch: assignment.branch,
    batchId: assignment.batchId,
    batch: assignment.batch,
    assignedById: assignment.assignedById,
    assignedBy: assignment.assignedBy,
    assignedAt: assignment.assignedAt,
    generatedFeeCount: generatedFees.length,
    generatedTotalPaise: generatedFees.reduce((sum: number, fee: any) => sum + fee.totalPaise, 0),
    generatedFees,
  };
}

function expectedComponentIds(plan: any) {
  return plan.installments.flatMap((installment: any) => installment.components.map((component: any) => component.id));
}

function assertComplete(assignment: any, componentIds: string[]) {
  const actual = assignment.fees ?? [];
  const unique = new Set(actual.map((fee: any) => fee.feePlanComponentId));
  const complete = actual.length === componentIds.length
    && unique.size === componentIds.length
    && componentIds.every(componentId => unique.has(componentId))
    && actual.every((fee: any) => fee.studentFeeAssignmentId === assignment.id && fee.feePlanComponentId);
  if (!complete) throw new AppError(409, "FEE_ASSIGNMENT_INCOMPLETE", "The existing fee assignment has an incomplete or inconsistent generated Fee set");
}

async function existingFamilyAssignment(db: Db, organizationId: string, studentId: string, academicSessionId: string, feePlanFamilyKey: string) {
  return db.studentFeeAssignment.findFirst({ where: { organizationId, studentId, academicSessionId, feePlanFamilyKey }, include: assignmentInclude });
}

router.get("/finance/fee-assignments", async (req: AuthRequest, res) => {
  const query = z.object({ studentId: id.optional(), academicSessionId: id.optional(), branchId: id.optional() }).parse(req.query);
  const branchIds = await assignedBranchIds(req);
  if (query.branchId && req.auth!.role !== Role.SUPER_ADMIN && !branchIds?.includes(query.branchId)) throw new AppError(403, "BRANCH_FORBIDDEN", "Branch access denied");
  const data = await prisma.studentFeeAssignment.findMany({
    where: { ...assignmentScope(req, branchIds), ...(query.studentId ? { studentId: query.studentId } : {}), ...(query.academicSessionId ? { academicSessionId: query.academicSessionId } : {}), ...(query.branchId ? { branchId: query.branchId } : {}) },
    include: assignmentInclude,
    orderBy: { assignedAt: "desc" },
  });
  res.json({ data: data.map(payload) });
});

router.get("/finance/fee-assignments/:id", async (req: AuthRequest, res) => {
  const branchIds = await assignedBranchIds(req);
  const assignment = await prisma.studentFeeAssignment.findFirst({ where: { id: String(req.params.id), ...assignmentScope(req, branchIds) }, include: assignmentInclude });
  if (!assignment) throw new AppError(404, "FEE_ASSIGNMENT_NOT_FOUND", "Fee assignment not found");
  res.json({ data: payload(assignment) });
});

router.post("/finance/fee-assignments", async (req: AuthRequest, res) => {
  const input = createInput.parse(req.body);
  const organizationId = req.auth!.organizationId;
  const branchIds = await assignedBranchIds(req);
  let attemptedPlan: { familyKey: string; academicSessionId: string; componentIds: string[] } | undefined;
  try {
    const result = await prisma.$transaction(async tx => {
      const student = await tx.studentProfile.findFirst({
        where: { id: input.studentId, organizationId },
        select: { id: true, organizationId: true, branchId: true, batchId: true, academicSessionId: true, batch: { select: { id: true, organizationId: true, branchId: true, courseId: true, academicSessionId: true } } },
      });
      if (!student) throw new AppError(404, "STUDENT_NOT_FOUND", "Student not found");
      if (!student.batch || student.batch.organizationId !== organizationId || student.batch.id !== student.batchId || student.batch.branchId !== student.branchId || student.batch.academicSessionId !== student.academicSessionId) {
        throw new AppError(409, "STUDENT_SCOPE_INVALID", "Student enrollment scope is inconsistent");
      }
      assertFinanceBranchAccess(req.auth!.role, branchIds ?? [], student.branchId);

      const plan = await tx.feePlan.findFirst({
        where: { id: input.feePlanId, organizationId },
        include: { installments: { orderBy: { sequence: "asc" }, include: { components: { orderBy: { position: "asc" } } } } },
      });
      if (!plan) throw new AppError(404, "FEE_PLAN_NOT_FOUND", "Fee plan not found");
      const componentIds = expectedComponentIds(plan);
      attemptedPlan = { familyKey: plan.familyKey, academicSessionId: plan.academicSessionId, componentIds };

      const existing = await existingFamilyAssignment(tx, organizationId, student.id, plan.academicSessionId, plan.familyKey);
      if (existing) {
        if (existing.feePlanId !== plan.id) throw new AppError(409, "FEE_ASSIGNMENT_FAMILY_EXISTS", "The student already has an assignment from this Fee Plan family for the academic session");
        assertComplete(existing, componentIds);
        return { assignment: existing, created: false };
      }

      if (plan.status !== FeePlanStatus.ACTIVE) throw new AppError(409, "FEE_PLAN_NOT_ACTIVE", "Only an active Fee Plan version can be assigned");
      if (student.academicSessionId !== plan.academicSessionId) throw new AppError(422, "FEE_PLAN_SESSION_MISMATCH", "Fee Plan academic session does not match the student");
      if (plan.branchId && student.branchId !== plan.branchId) throw new AppError(422, "FEE_PLAN_BRANCH_MISMATCH", "Fee Plan branch does not match the student");
      if (plan.courseId && student.batch.courseId !== plan.courseId) throw new AppError(422, "FEE_PLAN_COURSE_MISMATCH", "Fee Plan course does not match the student's batch");
      if (plan.batchId && student.batchId !== plan.batchId) throw new AppError(422, "FEE_PLAN_BATCH_MISMATCH", "Fee Plan batch does not match the student");

      const assignment = await tx.studentFeeAssignment.create({ data: { organizationId, studentId: student.id, feePlanId: plan.id, academicSessionId: student.academicSessionId, branchId: student.branchId, batchId: student.batchId, feePlanFamilyKey: plan.familyKey, assignedById: req.auth!.userId } });
      let generatedTotalPaise = 0;
      for (const installment of plan.installments) {
        for (const component of installment.components) {
          generatedTotalPaise += component.amountPaise;
          await tx.fee.create({ data: { organizationId, studentId: student.id, branchId: student.branchId, courseId: student.batch.courseId, batchId: student.batchId, studentFeeAssignmentId: assignment.id, feePlanComponentId: component.id, feeHead: component.feeHead, totalPaise: component.amountPaise, dueDate: installment.dueDate, status: feeStatus(component.amountPaise, 0, 0, 0, installment.dueDate) } });
        }
      }
      await tx.auditLog.create({ data: { organizationId, actorId: req.auth!.userId, action: "STUDENT_FEE_PLAN_ASSIGNED", entity: "StudentFeeAssignment", entityId: assignment.id, metadata: safeFinanceAuditMetadata({ studentId: student.id, feePlanId: plan.id, familyKey: plan.familyKey, version: plan.version, academicSessionId: student.academicSessionId, branchId: student.branchId, generatedFeeCount: componentIds.length, generatedTotalPaise }) } });
      const complete = await tx.studentFeeAssignment.findUnique({ where: { id: assignment.id }, include: assignmentInclude });
      return { assignment: complete, created: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.status(result.created ? 201 : 200).json({ created: result.created, data: payload(result.assignment) });
  } catch (error) {
    if (error instanceof AppError) throw error;
    const code = error && typeof error === "object" && "code" in error ? (error as { code?: string }).code : undefined;
    if ((code === "P2002" || isSerializableConflict(error)) && attemptedPlan) {
      const existing = await existingFamilyAssignment(prisma, organizationId, input.studentId, attemptedPlan.academicSessionId, attemptedPlan.familyKey);
      if (existing) {
        if (existing.feePlanId !== input.feePlanId) throw new AppError(409, "FEE_ASSIGNMENT_FAMILY_EXISTS", "The student already has an assignment from this Fee Plan family for the academic session");
        assertComplete(existing, attemptedPlan.componentIds);
        res.status(200).json({ created: false, data: payload(existing) });
        return;
      }
      throw new AppError(409, "FEE_ASSIGNMENT_CONFLICT", "The fee assignment changed concurrently; retry the request");
    }
    throw error;
  }
});

export default router;
