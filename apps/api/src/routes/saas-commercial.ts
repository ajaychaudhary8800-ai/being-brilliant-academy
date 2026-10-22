import {
  OrganizationSubscriptionStatus,
  Prisma,
  Role,
  SaaSBillingCycle,
  SaaSInvoiceStatus,
} from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { assertCommercialPlanFitsUsage, commercialAccessSnapshot, commercialEntitlementSnapshot } from "../lib/saas-commercial.js";
import { AppError } from "../lib/http.js";
import { systemPrisma } from "../lib/prisma.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function pdfEscape(value: string) {
  return value.replace(/[()\\]/g, character => `\\${character}`).replace(/[^\x20-\x7E]/g, "?");
}

function invoicePdfBuffer(title: string, lines: string[]) {
  const content = [title, ...lines]
    .slice(0, 42)
    .map((line, index) => `BT /F1 10 Tf 40 ${800 - index * 18} Td (${pdfEscape(line)}) Tj ET`)
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

function subscriptionInvoiceLines(invoice: {
  invoiceNo: string;
  amountPaise: number;
  taxPaise: number;
  totalPaise: number;
  currency: string;
  status: SaaSInvoiceStatus;
  periodStart: Date;
  periodEnd: Date;
  dueAt: Date | null;
  paidAt: Date | null;
  providerOrderId: string | null;
  metadata: unknown;
  organization: { name: string; email: string };
  plan: { name: string; code: string };
}) {
  const amount = (paise: number) => `${invoice.currency} ${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const metadata = record(invoice.metadata);
  const isAddons = metadata.basis === "SIGNED_ANNUAL_BASE_PLUS_ADDONS";
  const addons = isAddons && Array.isArray(metadata.addonLines)
    ? metadata.addonLines.filter(row => row && typeof row === "object" && !Array.isArray(row))
      .map(row => record(row))
      .filter(row => typeof row.code === "string" && typeof row.quantity === "number" && Number.isSafeInteger(row.quantity)
        && typeof row.unitPricePaise === "number" && Number.isSafeInteger(row.unitPricePaise))
    : [];
  const addonPaise = addons.reduce((sum, item) => sum + (item.quantity as number) * (item.unitPricePaise as number), 0);
  const addonLines = addons.slice(0, 22).map(item => {
    const code = String(item.code).slice(0, 50);
    return `Add-on ${String(item.category).slice(0, 20)}:${code} x${item.quantity} - ${amount((item.quantity as number) * (item.unitPricePaise as number))}`;
  });
  return [
    `Invoice: ${invoice.invoiceNo}`,
    `Customer: ${invoice.organization.name}`,
    `Customer email: ${invoice.organization.email}`,
    `Plan: ${invoice.plan.name} (${invoice.plan.code})`,
    `Period: ${invoice.periodStart.toISOString().slice(0, 10)} to ${invoice.periodEnd.toISOString().slice(0, 10)}`,
    ...(isAddons
      ? [`Base subscription: ${amount(invoice.amountPaise - addonPaise)}`,
        ...addonLines, `Add-ons subtotal: ${amount(addonPaise)}`,
        `Total before tax: ${amount(invoice.amountPaise)}`]
      : [`Base amount: ${amount(invoice.amountPaise)}`]),
    `Tax: ${amount(invoice.taxPaise)}`,
    `Total: ${amount(invoice.totalPaise)}`,
    `Status: ${invoice.status}`,
    `Due: ${invoice.dueAt?.toISOString().slice(0, 10) ?? "-"}`,
    `Paid: ${invoice.paidAt?.toISOString().slice(0, 10) ?? "-"}`,
    `Provider order: ${invoice.providerOrderId ?? "-"}`,
    "",
    "This document records the SaaS subscription billing transaction.",
  ];
}

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
  trialDays: z.number().int().min(0).max(3650).default(0),
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

router.get("/platform/saas/organizations/:organizationId/invoices/:invoiceId/pdf", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const organizationId = String(req.params.organizationId);
  const invoice = await systemPrisma.saaSInvoice.findFirst({
    where: { id: String(req.params.invoiceId), organizationId },
    include: { organization: { select: { name: true, email: true } }, plan: { select: { name: true, code: true } } },
  });
  if (!invoice) throw new AppError(404, "SAAS_INVOICE_NOT_FOUND", "Subscription invoice not found");
  const file = `${invoice.invoiceNo.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`;
  res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${file}"` })
    .send(invoicePdfBuffer("SaaS Subscription Invoice", subscriptionInvoiceLines(invoice)));
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

  // Existing paid subscriptions may retain unchanged terms for entitlement
  // controls, but platform settings must never mint or extend a paid period.
  // Only HMAC-verified capture of a signed contract can perform activation.
  if (data.status === OrganizationSubscriptionStatus.ACTIVE) {
    const current = await systemPrisma.saaSSubscription.findUnique({ where: { organizationId } });
    const sameDate = (a: Date | null | undefined, b: Date | null | undefined) =>
      (a?.toISOString().slice(0, 10) ?? null) === (b?.toISOString().slice(0, 10) ?? null);
    if (
      organization.subscriptionStatus !== OrganizationSubscriptionStatus.ACTIVE ||
      organization.subscriptionPlan !== plan.code ||
      current?.status !== OrganizationSubscriptionStatus.ACTIVE ||
      !sameDate(data.currentPeriodStart, current?.currentPeriodStart) ||
      !sameDate(data.currentPeriodEnd, current?.currentPeriodEnd)
    ) {
      throw new AppError(409, "SCHOOLOS_SIGNED_PAYMENT_REQUIRED",
        "Paid subscription activation, plan upgrades and term changes require verified signed-order payment.");
    }
  }

  const settings = record(organization.settings);
  const commercialEntitlements = {
    ...record(settings.commercialEntitlements),
    ...(data.enforcementEnabled === undefined ? {} : { enforce: data.enforcementEnabled }),
  };
  if (commercialEntitlements.enforce === true) await assertCommercialPlanFitsUsage(organizationId, plan.limits);

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

router.get("/organization/entitlements", async (req: AuthRequest, res) => {
  res.json({ data: await commercialEntitlementSnapshot(req.auth!.organizationId) });
});

router.get("/organization/subscription/plans", async (req: AuthRequest, res) => {
  requireTenantBillingAdmin(req);
  res.json({
    data: await systemPrisma.saaSPlan.findMany({
      where: { isActive: true, code: { not: "ENTERPRISE" } },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        monthlyPricePaise: true,
        annualPricePaise: true,
        trialDays: true,
        currency: true,
        taxRateBps: true,
        entitlements: true,
        limits: true,
      },
      orderBy: [{ monthlyPricePaise: "asc" }, { code: "asc" }],
    }),
  });
});

router.get("/organization/subscription/invoices/:invoiceId/pdf", async (req: AuthRequest, res) => {
  requireTenantBillingAdmin(req);
  const invoice = await systemPrisma.saaSInvoice.findFirst({
    where: { id: String(req.params.invoiceId), organizationId: req.auth!.organizationId },
    include: { organization: { select: { name: true, email: true } }, plan: { select: { name: true, code: true } } },
  });
  if (!invoice) throw new AppError(404, "SAAS_INVOICE_NOT_FOUND", "Subscription invoice not found");
  const file = `${invoice.invoiceNo.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`;
  res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${file}"` })
    .send(invoicePdfBuffer("SaaS Subscription Invoice", subscriptionInvoiceLines(invoice)));
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

router.patch("/organization/subscription/cancellation", async (req: AuthRequest, res) => {
  requireTenantBillingAdmin(req);
  const { cancelAtPeriodEnd } = z.object({ cancelAtPeriodEnd: z.boolean() }).parse(req.body);
  const organizationId = req.auth!.organizationId;
  const subscription = await systemPrisma.saaSSubscription.findUnique({
    where: { organizationId },
    include: { plan: { select: { code: true, name: true } } },
  });
  if (!subscription) throw new AppError(404, "SAAS_SUBSCRIPTION_NOT_FOUND", "Subscription record not found");
  if (subscription.status !== OrganizationSubscriptionStatus.ACTIVE || !subscription.currentPeriodEnd || subscription.currentPeriodEnd <= new Date()) {
    throw new AppError(409, "SAAS_CANCELLATION_UNAVAILABLE", "Cancellation scheduling is available only for an active paid subscription period");
  }
  if (subscription.cancelAtPeriodEnd === cancelAtPeriodEnd) {
    return res.json({ data: subscription });
  }
  const updated = await systemPrisma.$transaction(async tx => {
    const saved = await tx.saaSSubscription.update({
      where: { id: subscription.id },
      data: { cancelAtPeriodEnd },
      include: { plan: { select: { code: true, name: true } } },
    });
    await tx.auditLog.create({
      data: {
        organizationId,
        actorId: req.auth!.userId,
        action: cancelAtPeriodEnd ? "SAAS_CANCELLATION_SCHEDULED" : "SAAS_CANCELLATION_REVOKED",
        entity: "SaaSSubscription",
        entityId: subscription.id,
        metadata: { planCode: subscription.plan.code, currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() },
      },
    });
    return saved;
  });
  res.json({ data: updated });
});

// All V5 commercial payments must be linked to a verified signed quotation.
// Keep this legacy URL explicitly fail-closed so old clients cannot bypass
// /organization/subscription/contracted-checkout by forging a plan/amount.
router.post("/organization/subscription/checkout", (req: AuthRequest) => {
  requireTenantBillingAdmin(req);
  throw new AppError(
    409,
    "SCHOOLOS_SIGNED_QUOTE_REQUIRED",
    "Direct subscription checkout is disabled. Request an approved, signed SchoolOS quotation and pay the signed order.",
  );
});

export default router;
