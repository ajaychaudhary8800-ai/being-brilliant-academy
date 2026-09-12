import "express-async-errors";
import { FeePaymentOffsetType, FeeStatus, Prisma, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { assertFinanceBranchAccess, feeStatus, isSerializableConflict, safeFinanceAuditMetadata } from "../lib/finance-integrity.js";
import { AppError } from "../lib/http.js";
import { institutionDateRange } from "../lib/institution-time.js";
import { prisma } from "../lib/prisma.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN, Role.ACCOUNTANT));

const input = z.object({
  amountPaise: z.number().int().positive().max(2_147_483_647),
  reason: z.string().trim().min(1).max(2000),
  idempotencyKey: z.string().trim().min(1).max(120),
  reference: z.string().trim().max(200).nullable().optional(),
}).strict();
const query = z.object({
  feePaymentId: z.string().cuid().optional(),
  feeId: z.string().cuid().optional(),
  type: z.nativeEnum(FeePaymentOffsetType).optional(),
  branchId: z.string().cuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict().refine(value => Boolean(value.from) === Boolean(value.to), { message: "From and To dates must be provided together" });

const scope = async (req: AuthRequest) => req.auth!.role === Role.SUPER_ADMIN
  ? null
  : (await prisma.branchUser.findMany({ where: { organizationId: req.auth!.organizationId, userId: req.auth!.userId }, select: { branchId: true } })).map(row => row.branchId);

const access = (req: AuthRequest, ids: string[] | null, branchId: string) => {
  assertFinanceBranchAccess(req.auth!.role, ids ?? [], branchId);
};

const json = (value: any): any => typeof value === "bigint"
  ? Number(value)
  : Array.isArray(value)
    ? value.map(json)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, json(item)]))
      : value;

type PaymentRow = { organizationId: string; id: string; feeId: string; amountPaise: number };

const include = {
  feePayment: { include: { fee: { select: { id: true, organizationId: true, studentId: true, branchId: true, feeHead: true, totalPaise: true, discountPaise: true, finePaise: true, amountPaidPaise: true, dueDate: true, status: true, student: { select: { id: true, admissionNo: true, user: { select: { id: true, name: true } } } } } } } },
  createdBy: { select: { id: true, name: true, email: true } },
} as const;

function sameIntent(existing: any, data: z.infer<typeof input>, paymentId: string, type: FeePaymentOffsetType) {
  return existing.feePaymentId === paymentId
    && existing.type === type
    && Number(existing.amountPaise) === data.amountPaise
    && existing.reason === data.reason
    && (existing.reference ?? null) === (data.reference ?? null);
}

async function format(offset: any) {
  const original = Number(offset.feePayment.amountPaise);
  const aggregate = offset.__totalOffsetPaise === undefined
    ? await prisma.feePaymentOffset.aggregate({ where: { organizationId: offset.organizationId, feePaymentId: offset.feePaymentId }, _sum: { amountPaise: true } })
    : null;
  const totalOffset = offset.__totalOffsetPaise === undefined ? Number(aggregate?._sum.amountPaise ?? 0) : Number(offset.__totalOffsetPaise);
  const fee = offset.feePayment.fee;
  return {
    id: offset.id,
    type: offset.type,
    amountPaise: Number(offset.amountPaise),
    reason: offset.reason,
    reference: offset.reference,
    idempotencyKey: offset.idempotencyKey,
    feePaymentId: offset.feePaymentId,
    feeId: offset.feeId,
    studentId: fee.studentId,
    branchId: fee.branchId,
    createdBy: offset.createdBy,
    createdAt: offset.createdAt,
    originalPaymentPaise: original,
    totalOffsetPaise: totalOffset,
    remainingPaymentPaise: Math.max(0, original - totalOffset),
    effectiveAmountPaidPaise: Number(fee.amountPaidPaise),
    currentFeeStatus: fee.status,
    fee: { id: fee.id, feeHead: fee.feeHead, student: fee.student },
  };
}

async function readExisting(req: AuthRequest, idempotencyKey: string) {
  return prisma.feePaymentOffset.findUnique({ where: { organizationId_idempotencyKey: { organizationId: req.auth!.organizationId, idempotencyKey } }, include });
}

async function readAuthorizedExisting(req: AuthRequest, idempotencyKey: string, paymentId: string, type: FeePaymentOffsetType, data: z.infer<typeof input>) {
  const existing = await readExisting(req, idempotencyKey);
  if (!existing) return null;
  const fee = existing.feePayment?.fee;
  if (!fee || fee.organizationId !== req.auth!.organizationId) throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment not found");
  access(req, await scope(req), fee.branchId);
  if (!sameIntent(existing, data, paymentId, type)) throw new AppError(409, "PAYMENT_OFFSET_IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different payment offset");
  return existing;
}

async function createOffset(req: AuthRequest, paymentId: string, type: FeePaymentOffsetType, data: z.infer<typeof input>) {
  const permitted = await scope(req);
  try {
    const result = await prisma.$transaction(async tx => {
      const locked = await tx.$queryRaw<PaymentRow[]>(Prisma.sql`SELECT "organizationId", "id", "feeId", "amountPaise" FROM "FeePayment" WHERE "organizationId" = ${req.auth!.organizationId} AND "id" = ${paymentId} FOR UPDATE`);
      const payment = locked[0];
      if (!payment) throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment not found");
      const fee = await tx.fee.findUnique({ where: { id: payment.feeId }, select: { id: true, organizationId: true, studentId: true, branchId: true, totalPaise: true, discountPaise: true, finePaise: true, amountPaidPaise: true, dueDate: true, status: true } });
      if (!fee || fee.organizationId !== req.auth!.organizationId) throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment not found");
      access(req, permitted, fee.branchId);
      const existing = await tx.feePaymentOffset.findUnique({ where: { organizationId_idempotencyKey: { organizationId: req.auth!.organizationId, idempotencyKey: data.idempotencyKey } }, include });
      if (existing) {
        if (!sameIntent(existing, data, paymentId, type)) throw new AppError(409, "PAYMENT_OFFSET_IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different payment offset");
        const total = await tx.feePaymentOffset.aggregate({ where: { organizationId: req.auth!.organizationId, feePaymentId: paymentId }, _sum: { amountPaise: true } });
        return { offset: { ...existing, __totalOffsetPaise: Number(total._sum.amountPaise ?? 0) }, created: false };
      }
      const paymentTotals = await tx.feePaymentOffset.aggregate({ where: { organizationId: payment.organizationId, feePaymentId: payment.id }, _sum: { amountPaise: true } });
      const existingForPayment = Number(paymentTotals._sum.amountPaise ?? 0);
      if (existingForPayment + data.amountPaise > payment.amountPaise) throw new AppError(422, "PAYMENT_OFFSET_EXCEEDS_ORIGINAL", "Refunds and reversals cannot exceed the original payment amount");
      const originalTotals = await tx.feePayment.aggregate({ where: { organizationId: payment.organizationId, feeId: fee.id }, _sum: { amountPaise: true } });
      const offsetTotals = await tx.feePaymentOffset.aggregate({ where: { organizationId: payment.organizationId, feeId: fee.id }, _sum: { amountPaise: true } });
      const expectedPaid = Math.max(0, Number(originalTotals._sum.amountPaise ?? 0) - Number(offsetTotals._sum.amountPaise ?? 0));
      if (Number(fee.amountPaidPaise) !== expectedPaid) throw new AppError(409, "PAYMENT_LEDGER_INCONSISTENT", "Fee payment ledger is inconsistent; no offset was created");
      const nextPaid = expectedPaid - data.amountPaise;
      if (nextPaid < 0) throw new AppError(409, "PAYMENT_LEDGER_INCONSISTENT", "Fee payment ledger would become negative");
      const offset = await tx.feePaymentOffset.create({ data: { organizationId: payment.organizationId, feePaymentId: payment.id, feeId: fee.id, type, amountPaise: data.amountPaise, reason: data.reason, idempotencyKey: data.idempotencyKey, reference: data.reference ?? null, createdById: req.auth!.userId }, include });
      const status = feeStatus(fee.totalPaise, fee.discountPaise, fee.finePaise, nextPaid, fee.dueDate);
      const updatedFee = await tx.fee.update({ where: { id: fee.id }, data: { amountPaidPaise: nextPaid, status } });
      await tx.auditLog.create({ data: { organizationId: req.auth!.organizationId, actorId: req.auth!.userId, action: type === FeePaymentOffsetType.REFUND ? "FEE_PAYMENT_REFUNDED" : "FEE_PAYMENT_REVERSED", entity: "FeePaymentOffset", entityId: offset.id, metadata: safeFinanceAuditMetadata({ feeId: fee.id, feePaymentId: payment.id, branchId: fee.branchId, amountPaise: data.amountPaise, type, idempotencyKey: data.idempotencyKey, originalPaymentPaise: payment.amountPaise, remainingPaymentPaise: payment.amountPaise - existingForPayment - data.amountPaise }) } });
      return {
        offset: {
          ...offset,
          feePayment: {
            ...offset.feePayment,
            fee: { ...offset.feePayment.fee, amountPaidPaise: updatedFee.amountPaidPaise, status: updatedFee.status },
          },
          __totalOffsetPaise: existingForPayment + data.amountPaise,
        },
        created: true,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { data: await format(result.offset), created: result.created };
  } catch (error) {
    if (isSerializableConflict(error)) {
      const existing = await readAuthorizedExisting(req, data.idempotencyKey, paymentId, type, data);
      if (existing) return { data: await format(existing), created: false };
      throw new AppError(409, "PAYMENT_OFFSET_CONFLICT", "The payment changed; reload and try again");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await readAuthorizedExisting(req, data.idempotencyKey, paymentId, type, data);
      if (existing) return { data: await format(existing), created: false };
    }
    throw error;
  }
}

for (const [suffix, type] of [["refunds", FeePaymentOffsetType.REFUND], ["reversals", FeePaymentOffsetType.REVERSAL]] as const) {
  router.post(`/finance/payments/:paymentId/${suffix}`, async (req: AuthRequest, res) => {
    if (req.auth!.role === Role.ACCOUNTANT) throw new AppError(403, "ACCOUNTANT_PAYMENT_OFFSET_READ_ONLY", "Accountants may only read payment offsets");
    const data = input.parse(req.body);
    const result = await createOffset(req, String(req.params.paymentId), type, data);
    res.status(result.created ? 201 : 200).json(result);
  });
}

router.get("/finance/payment-offsets", async (req: AuthRequest, res) => {
  const filters = query.parse(req.query);
  const permitted = await scope(req);
  if (permitted && permitted.length === 0) return res.json({ data: [], meta: { total: 0, page: filters.page, limit: filters.limit, totalPages: 1 } });
  const branchIds = filters.branchId ? [filters.branchId] : permitted;
  if (filters.branchId && permitted && !permitted.includes(filters.branchId)) throw new AppError(403, "BRANCH_FORBIDDEN", "Branch access denied");
  const organization = filters.from && filters.to ? await prisma.organization.findUnique({ where: { id: req.auth!.organizationId }, select: { timezone: true } }) : null;
  if (filters.from && filters.to && !organization) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found");
  const range = filters.from && filters.to ? institutionDateRange(filters.from, filters.to, organization!.timezone) : null;
  const where: any = { organizationId: req.auth!.organizationId, ...(filters.feePaymentId ? { feePaymentId: filters.feePaymentId } : {}), ...(filters.feeId ? { feeId: filters.feeId } : {}), ...(filters.type ? { type: filters.type } : {}), ...(range ? { createdAt: { gte: range.start, lt: range.endExclusive } } : {}), ...(branchIds ? { feePayment: { fee: { branchId: { in: branchIds } } } } : {}) };
  const [rows, total] = await Promise.all([
    prisma.feePaymentOffset.findMany({ where, include, orderBy: { createdAt: "desc" }, skip: (filters.page - 1) * filters.limit, take: filters.limit }),
    prisma.feePaymentOffset.count({ where }),
  ]);
  res.json({ data: await Promise.all(rows.map(format)), meta: { total, page: filters.page, limit: filters.limit, totalPages: Math.max(1, Math.ceil(total / filters.limit)) } });
});

router.get("/finance/payment-offsets/:id", async (req: AuthRequest, res) => {
  const offset = await prisma.feePaymentOffset.findFirst({ where: { id: String(req.params.id), organizationId: req.auth!.organizationId }, include });
  if (!offset) throw new AppError(404, "OFFSET_NOT_FOUND", "Payment offset not found");
  const permitted = await scope(req);
  access(req, permitted, offset.feePayment.fee.branchId);
  res.json({ data: await format(offset) });
});

export default router;
