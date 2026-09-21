import crypto from "node:crypto";
import Razorpay from "razorpay";
import {
  OrganizationSubscriptionStatus,
  Prisma,
  Role,
  SaaSBillingCycle,
  SaaSInvoiceStatus,
} from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config.js";
import { assertCommercialPlanFitsUsage, commercialAccessSnapshot } from "../lib/saas-commercial.js";
import { AppError } from "../lib/http.js";
import { systemPrisma } from "../lib/prisma.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function requirePlatformAdmin(req: AuthRequest) {
  if (req.auth!.role !== Role.SUPER_ADMIN || req.auth!.homeOrganizationId !== "org_default") {
    throw new AppError(403, "PLATFORM_ADMIN_REQUIRED", "Platform super administrator access required");
  }
}

function requireTenantBillingAdmin(req: AuthRequest) {
  if (req.auth!.role !== Role.SUPER_ADMIN) {
    throw new AppError(403, "TENANT_BILLING_ADMIN_REQUIRED", "Organization super administrator access required");
  }
}

const planInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,40}$/),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).nullable().optional(),
  monthlyPricePaise: z.number().int().nonnegative(),
  annualPricePaise: z.number().int().nonnegative(),
  currency: z.string().trim().toUpperCase().length(3).default("INR"),
  taxRateBps: z.number().int().min(0).max(10_000).default(0),
  entitlements: z.record(z.boolean()).default({ "*": true }),
  limits: z.record(z.number().int().nonnegative().nullable()).default({}),
  isActive: z.boolean().default(true),
});

const subscriptionInput = z.object({
  planCode: z.string().trim().toUpperCase().min(2).max(40),
  status: z.nativeEnum(OrganizationSubscriptionStatus),
  billingCycle: z.nativeEnum(SaaSBillingCycle).default(SaaSBillingCycle.MONTHLY),
  currentPeriodStart: z.coerce.date().nullable().optional(),
  currentPeriodEnd: z.coerce.date().nullable().optional(),
  cancelAtPeriodEnd: z.boolean().default(false),
  enforcementEnabled: z.boolean().optional(),
});

router.get("/platform/saas/plans", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  res.json({
    data: await systemPrisma.saaSPlan.findMany({
      orderBy: [{ isActive: "desc" }, { monthlyPricePaise: "asc" }, { code: "asc" }],
    }),
  });
});

router.post("/platform/saas/plans", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const data = planInput.parse(req.body);
  if (await systemPrisma.saaSPlan.findUnique({ where: { code: data.code }, select: { id: true } })) {
    throw new AppError(409, "SAAS_PLAN_EXISTS", "A SaaS plan with this code already exists");
  }
  const plan = await systemPrisma.saaSPlan.create({
    data: {
      ...data,
      description: data.description ?? null,
      entitlements: data.entitlements as Prisma.InputJsonValue,
      limits: data.limits as Prisma.InputJsonValue,
    },
  });
  await systemPrisma.auditLog.create({
    data: {
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      action: "SAAS_PLAN_CREATED",
      entity: "SaaSPlan",
      entityId: plan.id,
      metadata: { code: plan.code },
    },
  });
  res.status(201).json({ data: plan });
});

router.patch("/platform/saas/plans/:id", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const data = planInput.partial().parse(req.body);
  const existing = await systemPrisma.saaSPlan.findUnique({ where: { id: String(req.params.id) } });
  if (!existing) throw new AppError(404, "SAAS_PLAN_NOT_FOUND", "SaaS plan not found");
  if (data.code && data.code !== existing.code) {
    const duplicate = await systemPrisma.saaSPlan.findUnique({ where: { code: data.code }, select: { id: true } });
    if (duplicate && duplicate.id !== existing.id) throw new AppError(409, "SAAS_PLAN_EXISTS", "A SaaS plan with this code already exists");
  }
  const plan = await systemPrisma.saaSPlan.update({
    where: { id: existing.id },
    data: {
      ...data,
      ...(data.entitlements === undefined ? {} : { entitlements: data.entitlements as Prisma.InputJsonValue }),
      ...(data.limits === undefined ? {} : { limits: data.limits as Prisma.InputJsonValue }),
    },
  });
  await systemPrisma.auditLog.create({
    data: {
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      action: "SAAS_PLAN_UPDATED",
      entity: "SaaSPlan",
      entityId: plan.id,
      metadata: { code: plan.code },
    },
  });
  res.json({ data: plan });
});

router.get("/platform/saas/organizations/:organizationId", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const organizationId = String(req.params.organizationId);
  const snapshot = await commercialAccessSnapshot(organizationId);
  const [invoices, payments] = await Promise.all([
    systemPrisma.saaSInvoice.findMany({
      where: { organizationId },
      include: { payments: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    systemPrisma.saaSPayment.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  res.json({ data: { ...snapshot, invoices, payments } });
});

router.patch("/platform/saas/organizations/:organizationId/subscription", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const organizationId = String(req.params.organizationId);
  const data = subscriptionInput.parse(req.body);
  const [organization, plan] = await Promise.all([
    systemPrisma.organization.findUnique({ where: { id: organizationId } }),
    systemPrisma.saaSPlan.findUnique({ where: { code: data.planCode } }),
  ]);
  if (!organization || organization.deletedAt) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found");
  if (!plan) throw new AppError(404, "SAAS_PLAN_NOT_FOUND", "SaaS plan not found");

  const settings = record(organization.settings);
  const commercialEntitlements = {
    ...record(settings.commercialEntitlements),
    ...(data.enforcementEnabled === undefined ? {} : { enforce: data.enforcementEnabled }),
  };
  if (data.enforcementEnabled === true) await assertCommercialPlanFitsUsage(organizationId, plan.limits);

  const subscription = await systemPrisma.$transaction(async tx => {
    const saved = await tx.saaSSubscription.upsert({
      where: { organizationId },
      create: {
        organizationId,
        planId: plan.id,
        status: data.status,
        billingCycle: data.billingCycle,
        currentPeriodStart: data.currentPeriodStart ?? null,
        currentPeriodEnd: data.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: data.cancelAtPeriodEnd,
      },
      update: {
        planId: plan.id,
        status: data.status,
        billingCycle: data.billingCycle,
        currentPeriodStart: data.currentPeriodStart ?? null,
        currentPeriodEnd: data.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: data.cancelAtPeriodEnd,
      },
      include: { plan: true },
    });
    await tx.organization.update({
      where: { id: organizationId },
      data: {
        subscriptionPlan: plan.code,
        subscriptionStatus: data.status,
        subscriptionEndsAt: data.currentPeriodEnd ?? null,
        settings: { ...settings, commercialEntitlements } as Prisma.InputJsonValue,
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId,
        actorId: req.auth!.userId,
        action: "SAAS_SUBSCRIPTION_UPDATED",
        entity: "SaaSSubscription",
        entityId: saved.id,
        metadata: {
          planCode: plan.code,
          status: data.status,
          billingCycle: data.billingCycle,
          enforcementEnabled: commercialEntitlements.enforce === true,
        },
      },
    });
    return saved;
  });

  res.json({ data: { subscription, snapshot: await commercialAccessSnapshot(organizationId) } });
});

router.get("/organization/subscription/plans", async (req: AuthRequest, res) => {
  requireTenantBillingAdmin(req);
  res.json({
    data: await systemPrisma.saaSPlan.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        monthlyPricePaise: true,
        annualPricePaise: true,
        currency: true,
        taxRateBps: true,
        entitlements: true,
        limits: true,
      },
      orderBy: [{ monthlyPricePaise: "asc" }, { code: "asc" }],
    }),
  });
});

router.get("/organization/subscription", async (req: AuthRequest, res) => {
  requireTenantBillingAdmin(req);
  const organizationId = req.auth!.organizationId;
  const snapshot = await commercialAccessSnapshot(organizationId);
  const invoices = await systemPrisma.saaSInvoice.findMany({
    where: { organizationId },
    include: { payments: true },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
  res.json({ data: { ...snapshot, invoices } });
});

const checkoutInput = z.object({
  planCode: z.string().trim().toUpperCase().min(2).max(40),
  billingCycle: z.enum(["MONTHLY", "ANNUAL"]),
});

function addBillingPeriod(start: Date, cycle: "MONTHLY" | "ANNUAL") {
  const end = new Date(start);
  if (cycle === "ANNUAL") end.setUTCFullYear(end.getUTCFullYear() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  return end;
}

router.post("/organization/subscription/checkout", async (req: AuthRequest, res) => {
  requireTenantBillingAdmin(req);
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new AppError(503, "PAYMENT_UNAVAILABLE", "Razorpay is not configured");
  }
  const idempotencyKey = req.header("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 100) {
    throw new AppError(422, "IDEMPOTENCY_KEY_REQUIRED", "Provide an Idempotency-Key header between 8 and 100 characters");
  }

  const organizationId = req.auth!.organizationId;
  const body = checkoutInput.parse(req.body);
  const [organization, plan] = await Promise.all([
    systemPrisma.organization.findUnique({ where: { id: organizationId } }),
    systemPrisma.saaSPlan.findUnique({ where: { code: body.planCode } }),
  ]);
  if (!organization || organization.deletedAt) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found");
  if (!plan || !plan.isActive) throw new AppError(404, "SAAS_PLAN_NOT_FOUND", "SaaS plan is unavailable");

  const existing = await systemPrisma.saaSInvoice.findUnique({ where: { checkoutKey: idempotencyKey } });
  if (existing) {
    if (existing.organizationId !== organizationId) throw new AppError(409, "IDEMPOTENCY_KEY_CONFLICT", "Idempotency key is already in use");
    if (existing.providerOrderId) {
      return res.json({
        data: {
          reused: true,
          invoiceId: existing.id,
          keyId: env.RAZORPAY_KEY_ID,
          order: {
            id: existing.providerOrderId,
            amount: existing.totalPaise,
            currency: existing.currency,
            receipt: existing.invoiceNo,
          },
        },
      });
    }
    if (existing.status !== SaaSInvoiceStatus.VOID) {
      throw new AppError(409, "CHECKOUT_IN_PROGRESS", "A checkout with this idempotency key is already in progress");
    }
  }

  const baseAmount = body.billingCycle === "ANNUAL" ? plan.annualPricePaise : plan.monthlyPricePaise;
  if (baseAmount <= 0) throw new AppError(409, "SAAS_PLAN_NOT_PRICED", "This SaaS plan does not yet have a checkout price");
  const taxPaise = Math.round(baseAmount * plan.taxRateBps / 10_000);
  const totalPaise = baseAmount + taxPaise;
  const periodStart = new Date();
  const periodEnd = addBillingPeriod(periodStart, body.billingCycle);
  const invoiceNo = existing?.invoiceNo ?? `SAA-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  const subscription = await systemPrisma.saaSSubscription.upsert({
    where: { organizationId },
    create: {
      organizationId,
      planId: plan.id,
      status: organization.subscriptionStatus,
      billingCycle: body.billingCycle,
    },
    update: {
      planId: plan.id,
      billingCycle: body.billingCycle,
    },
  });

  let invoice = existing
    ? await systemPrisma.saaSInvoice.update({
        where: { id: existing.id },
        data: {
          subscriptionId: subscription.id,
          amountPaise: baseAmount,
          taxPaise,
          totalPaise,
          currency: plan.currency,
          status: SaaSInvoiceStatus.OPEN,
          periodStart,
          periodEnd,
          dueAt: periodStart,
          provider: "RAZORPAY",
        },
      })
    : await systemPrisma.saaSInvoice.create({
        data: {
          organizationId,
          subscriptionId: subscription.id,
          invoiceNo,
          checkoutKey: idempotencyKey,
          amountPaise: baseAmount,
          taxPaise,
          totalPaise,
          currency: plan.currency,
          status: SaaSInvoiceStatus.OPEN,
          periodStart,
          periodEnd,
          dueAt: periodStart,
          provider: "RAZORPAY",
          metadata: { planCode: plan.code, billingCycle: body.billingCycle } as Prisma.InputJsonValue,
        },
      });

  try {
    const client = new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
    const order = await client.orders.create({
      amount: totalPaise,
      currency: plan.currency,
      receipt: invoice.invoiceNo.slice(0, 40),
      notes: { organizationId, invoiceId: invoice.id, planCode: plan.code },
    });
    invoice = await systemPrisma.saaSInvoice.update({
      where: { id: invoice.id },
      data: { providerOrderId: order.id },
    });
    await systemPrisma.auditLog.create({
      data: {
        organizationId,
        actorId: req.auth!.userId,
        action: "SAAS_CHECKOUT_CREATED",
        entity: "SaaSInvoice",
        entityId: invoice.id,
        metadata: { planCode: plan.code, billingCycle: body.billingCycle, totalPaise, providerOrderId: order.id },
      },
    });
    return res.status(201).json({ data: { reused: false, order, invoiceId: invoice.id, keyId: env.RAZORPAY_KEY_ID } });
  } catch (error) {
    await systemPrisma.saaSInvoice.update({
      where: { id: invoice.id },
      data: { status: SaaSInvoiceStatus.VOID },
    }).catch(() => undefined);
    throw error;
  }
});

export default router;
