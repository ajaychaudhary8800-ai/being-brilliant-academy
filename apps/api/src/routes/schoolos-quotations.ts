import crypto from "node:crypto";
import { Prisma, Role, SaaSBillingCycle } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/http.js";
import { systemPrisma } from "../lib/prisma.js";
import { isSchoolOSFeature } from "../lib/schoolos-feature-policy.js";
import { validateSchoolOSApprovedAddonLines } from "../lib/schoolos-addon-pricing-policy.js";
import { calculateSchoolOSQuote, type SchoolOSQuoteItem } from "../lib/schoolos-quotation.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

function requirePlatformAdmin(req: AuthRequest) {
  if (req.auth?.role !== Role.SUPER_ADMIN || req.auth.homeOrganizationId !== "org_default") {
    throw new AppError(403, "PLATFORM_ADMIN_REQUIRED", "Platform super administrator access required");
  }
}

const quoteLine = z.object({
  category: z.enum(["MODULE", "CAPACITY", "AI_USAGE", "VIDEO_USAGE", "IMPLEMENTATION", "CUSTOM_WORK"]),
  code: z.string().trim().regex(/^[a-z0-9_-]{2,50}$/),
  label: z.string().trim().min(2).max(120),
  quantity: z.number().int().min(1).max(100_000),
  unitPricePaise: z.number().int().nonnegative().max(2_147_483_647),
}).strict();
const draftInput = z.object({
  organizationId: z.string().min(2).max(80).nullable().optional(),
  clientName: z.string().trim().min(2).max(160),
  clientEmail: z.string().trim().email().nullable().optional(),
  planCode: z.string().trim().toUpperCase().min(2).max(40),
  billingCycle: z.enum(["MONTHLY", "ANNUAL"]),
  validUntil: z.string().datetime({ offset: true }),
  items: z.array(quoteLine).max(60).default([]),
  discountBps: z.number().int().min(0).max(5000).default(0),
}).strict();

async function buildDraft(input: z.infer<typeof draftInput>) {
  const plan = await systemPrisma.saaSPlan.findUnique({ where: { code: input.planCode } });
  if (!plan || !plan.isActive) throw new AppError(404, "SAAS_PLAN_NOT_FOUND", "Active SaaS plan not found");
  if (input.organizationId) {
    const organization = await systemPrisma.organization.findUnique({
      where: { id: input.organizationId }, select: { deletedAt: true },
    });
    if (!organization || organization.deletedAt || input.organizationId === "org_default")
      throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Client organization not found");
  }
  const days = (new Date(input.validUntil).getTime() - Date.now()) / 86_400_000;
  if (days < 1 || days > 90)
    throw new AppError(422, "QUOTE_VALIDITY_INVALID", "Quote validity must be between 1 and 90 days");
  for (const item of input.items) {
    if (item.category === "MODULE" && !isSchoolOSFeature(item.code))
      throw new AppError(422, "QUOTE_MODULE_UNKNOWN", "Module must be in the SchoolOS feature catalogue");
    if (item.category === "CAPACITY" && !["students", "users", "branches", "storage_gb", "video_minutes", "ai_credits"].includes(item.code))
      throw new AppError(422, "QUOTE_CAPACITY_UNKNOWN", "Unknown capacity extension");
  }
  let pricing;
  try {
    pricing = calculateSchoolOSQuote({
      basePricePaise: input.billingCycle === "MONTHLY" ? plan.monthlyPricePaise : plan.annualPricePaise,
      items: input.items as SchoolOSQuoteItem[],
      discountBps: input.discountBps,
      taxRateBps: plan.taxRateBps,
    });
  } catch (cause) {
    if (cause instanceof RangeError) throw new AppError(422, "QUOTE_PRICING_INVALID", cause.message);
    throw cause;
  }
  // All non-base line item prices must be approved in the immutable
  // maker-checker rate catalogue. Never accept arbitrary client-entered prices.
  const rateRows = input.items.length ? await systemPrisma.schoolOSAddonRate.findMany({
    where: { status: "APPROVED", OR: input.items.map(item => ({ category: item.category, code: item.code })) },
  }) : [];
  let addonRateSnapshot;
  try {
    addonRateSnapshot = validateSchoolOSApprovedAddonLines(input.items as SchoolOSQuoteItem[], rateRows, {
      currency: plan.currency, taxRateBps: plan.taxRateBps,
      now: new Date(), validUntil: new Date(input.validUntil),
    });
  } catch (cause) {
    throw new AppError(422, "SCHOOLOS_ADDON_PRICING_NOT_APPROVED",
      cause instanceof Error ? cause.message : "Unapproved or mismatched add-on price");
  }
  const rateCardSnapshot = {
    planId: plan.id, planCode: plan.code, planName: plan.name,
    planUpdatedAt: plan.updatedAt.toISOString(), currency: plan.currency,
    billingCycle: input.billingCycle,
    basePricePaise: input.billingCycle === "MONTHLY" ? plan.monthlyPricePaise : plan.annualPricePaise,
    taxRateBps: plan.taxRateBps, planEntitlements: plan.entitlements, planLimits: plan.limits,
  };
  return { pricing, rateCardSnapshot, addonRateSnapshot, plan };
}

router.post("/platform/schoolos/quotes/preview", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const input = draftInput.parse(req.body);
  const { pricing, rateCardSnapshot, addonRateSnapshot } = await buildDraft(input);
  res.json({ data: { pricing, rateCardSnapshot, addonRateSnapshot, items: input.items, draftOnly: true } });
});

router.post("/platform/schoolos/quotes", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const input = draftInput.parse(req.body);
  const { pricing, rateCardSnapshot, addonRateSnapshot, plan } = await buildDraft(input);
  const quote = await systemPrisma.$transaction(async tx => {
    const created = await tx.schoolOSQuotation.create({
      data: {
        quoteNo: `SO5-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        organizationId: input.organizationId ?? null,
        clientName: input.clientName, clientEmail: input.clientEmail ?? null,
        planCode: plan.code, billingCycle: input.billingCycle as SaaSBillingCycle,
        validUntil: new Date(input.validUntil),
        items: input.items as Prisma.InputJsonValue,
        pricingSnapshot: { pricing, rateCardSnapshot, addonRateSnapshot } as Prisma.InputJsonValue,
        subtotalPaise: pricing.subtotalPaise, discountBps: pricing.discountBps,
        discountPaise: pricing.discountPaise, taxRateBps: pricing.taxRateBps,
        taxPaise: pricing.taxPaise, totalPaise: pricing.totalPaise,
        createdBy: req.auth!.userId, updatedBy: req.auth!.userId,
      },
    });
    await tx.schoolOSQuotationRevision.create({
      data: { quoteId: created.id, version: 1, action: "CREATED", actorId: req.auth!.userId, snapshot: { input, pricing, rateCardSnapshot, addonRateSnapshot } as Prisma.InputJsonValue },
    });
    await tx.auditLog.create({
      data: { organizationId: "org_default", actorId: req.auth!.userId, action: "SCHOOLOS_QUOTE_DRAFT_CREATED", entity: "SchoolOSQuotation", entityId: created.id, metadata: { quoteNo: created.quoteNo, organizationId: created.organizationId, totalPaise: created.totalPaise } },
    });
    return created;
  });
  res.status(201).json({ data: quote });
});

router.get("/platform/schoolos/quotes", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const page = z.coerce.number().int().min(1).default(1).parse(req.query.page);
  const take = 30;
  const [quotes, count] = await Promise.all([
    systemPrisma.schoolOSQuotation.findMany({ orderBy: { createdAt: "desc" }, skip: (page - 1) * take, take }),
    systemPrisma.schoolOSQuotation.count(),
  ]);
  res.json({ data: quotes, meta: { page, total: count } });
});

router.get("/platform/schoolos/quotes/:id", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const quote = await systemPrisma.schoolOSQuotation.findUnique({
    where: { id: String(req.params.id) }, include: { revisions: { orderBy: { version: "asc" } } },
  });
  if (!quote) throw new AppError(404, "SCHOOLOS_QUOTE_NOT_FOUND", "Quotation not found");
  res.json({ data: quote });
});

router.patch("/platform/schoolos/quotes/:id", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const id = String(req.params.id);
  const input = draftInput.extend({ expectedVersion: z.number().int().min(1) }).parse(req.body);
  const { expectedVersion, ...fields } = input;
  const { pricing, rateCardSnapshot, addonRateSnapshot, plan } = await buildDraft(fields);
  const saved = await systemPrisma.$transaction(async tx => {
    const updated = await tx.schoolOSQuotation.updateMany({
      where: { id, version: expectedVersion, status: "DRAFT" },
      data: {
        version: { increment: 1 }, organizationId: fields.organizationId ?? null,
        clientName: fields.clientName, clientEmail: fields.clientEmail ?? null,
        planCode: plan.code, billingCycle: fields.billingCycle as SaaSBillingCycle,
        validUntil: new Date(fields.validUntil),
        items: fields.items as Prisma.InputJsonValue,
        pricingSnapshot: { pricing, rateCardSnapshot, addonRateSnapshot } as Prisma.InputJsonValue,
        subtotalPaise: pricing.subtotalPaise, discountBps: pricing.discountBps,
        discountPaise: pricing.discountPaise, taxRateBps: pricing.taxRateBps,
        taxPaise: pricing.taxPaise, totalPaise: pricing.totalPaise,
        updatedBy: req.auth!.userId,
      },
    });
    if (updated.count !== 1) throw new AppError(409, "SCHOOLOS_QUOTE_VERSION_CONFLICT", "Quote version changed or this quote is no longer editable");
    const quote = await tx.schoolOSQuotation.findUniqueOrThrow({ where: { id } });
    await tx.schoolOSQuotationRevision.create({
      data: { quoteId: quote.id, version: quote.version, action: "REPRICED", actorId: req.auth!.userId, snapshot: { input: fields, pricing, rateCardSnapshot, addonRateSnapshot } as Prisma.InputJsonValue },
    });
    await tx.auditLog.create({
      data: { organizationId: "org_default", actorId: req.auth!.userId, action: "SCHOOLOS_QUOTE_DRAFT_REVISED", entity: "SchoolOSQuotation", entityId: quote.id, metadata: { quoteNo: quote.quoteNo, version: quote.version } },
    });
    return quote;
  });
  res.json({ data: saved });
});


const approvalInput = z.object({
  expectedVersion: z.number().int().min(1),
  decision: z.enum(["SUBMIT_FOR_REVIEW", "APPROVE", "REJECT", "RETURN_TO_DRAFT"]),
  rationale: z.string().trim().min(12).max(1000),
}).strict();

/**
 * Internal approval is independent of billing or activation.
 * A quote remains an internal estimate until commercial prices are reconciled
 * and external issuance is separately implemented and authorised.
 */
router.post("/platform/schoolos/quotes/:id/decision", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const id = String(req.params.id);
  const input = approvalInput.parse(req.body);
  const transitions: Record<string, { expected: string; next: string }> = {
    SUBMIT_FOR_REVIEW: { expected: "DRAFT", next: "PENDING_APPROVAL" },
    APPROVE: { expected: "PENDING_APPROVAL", next: "INTERNALLY_APPROVED" },
    REJECT: { expected: "PENDING_APPROVAL", next: "REJECTED" },
    RETURN_TO_DRAFT: { expected: "REJECTED", next: "DRAFT" },
  };
  const transition = transitions[input.decision];
  const result = await systemPrisma.$transaction(async tx => {
    const current = await tx.schoolOSQuotation.findUnique({ where: { id } });
    if (!current) throw new AppError(404, "SCHOOLOS_QUOTE_NOT_FOUND", "Quotation not found");
    if (current.version !== input.expectedVersion || current.status !== transition.expected) {
      throw new AppError(409, "SCHOOLOS_QUOTE_STATE_CONFLICT", "Quotation state or version changed");
    }
    if (new Date(current.validUntil).getTime() <= Date.now()) {
      throw new AppError(409, "SCHOOLOS_QUOTE_EXPIRED", "Expired quotations cannot be approved or reviewed");
    }
    if (input.decision === "APPROVE" && current.createdBy === req.auth!.userId) {
      throw new AppError(403, "SCHOOLOS_QUOTE_SEPARATION_OF_DUTIES", "A different platform administrator must approve this quotation");
    }
    if (input.decision === "APPROVE" && current.updatedBy === req.auth!.userId) {
      throw new AppError(403, "SCHOOLOS_QUOTE_SEPARATION_OF_DUTIES", "The last person to edit this quotation cannot approve it");
    }
    const changed = await tx.schoolOSQuotation.updateMany({
      where: { id, version: input.expectedVersion, status: transition.expected },
      data: { status: transition.next, version: { increment: 1 }, updatedBy: req.auth!.userId },
    });
    if (changed.count !== 1) throw new AppError(409, "SCHOOLOS_QUOTE_STATE_CONFLICT", "Concurrent quotation change");
    const quote = await tx.schoolOSQuotation.findUniqueOrThrow({ where: { id } });
    await tx.schoolOSQuotationRevision.create({
      data: { quoteId: id, version: quote.version, action: input.decision, actorId: req.auth!.userId,
        snapshot: { status: quote.status, rationale: input.rationale, quoteNo: quote.quoteNo, pricingSnapshot: quote.pricingSnapshot } as Prisma.InputJsonValue },
    });
    await tx.auditLog.create({
      data: { organizationId: "org_default", actorId: req.auth!.userId, action: "SCHOOLOS_QUOTE_" + input.decision,
        entity: "SchoolOSQuotation", entityId: quote.id,
        metadata: { version: quote.version, status: quote.status, rationale: input.rationale } },
    });
    return quote;
  });
  res.json({ data: { ...result, externalIssueAllowed: false, subscriptionActivated: false } });
});

export default router;
