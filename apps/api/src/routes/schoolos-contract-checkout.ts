import crypto from "node:crypto";
import { OrganizationSubscriptionStatus, Prisma, Role, SaaSBillingCycle, SaaSInvoiceStatus } from "@prisma/client";
import Razorpay from "razorpay";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config.js";
import { AppError } from "../lib/http.js";
import { systemPrisma } from "../lib/prisma.js";
import { assertCommercialPlanFitsUsage } from "../lib/saas-commercial.js";
import { validateSchoolOSBaseQuoteCheckout } from "../lib/schoolos-contract-payment-policy.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);
const checkoutInput = z.object({ quoteId: z.string().min(2).max(100) }).strict();

const addYear = (start: Date) => {
  const end = new Date(start);
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  return end;
};

router.get("/organization/subscription/contracted-quotes", async (req: AuthRequest, res) => {
  if (req.auth?.role !== Role.SUPER_ADMIN || req.auth.homeOrganizationId !== req.auth.organizationId || req.auth.organizationId === "org_default")
    throw new AppError(403, "TENANT_BILLING_ADMIN_REQUIRED", "Tenant administrator required");
  const quotes = await systemPrisma.schoolOSQuotation.findMany({
    where: { organizationId: req.auth.organizationId, status: { in: ["CONTRACTED", "PAYMENT_PENDING", "PAID"] } },
    orderBy: { createdAt: "desc" }, take: 25,
    select: { id: true, quoteNo: true, status: true, planCode: true, billingCycle: true,
      totalPaise: true, validUntil: true,
      checkoutInvoice: { select: { id: true, status: true, providerOrderId: true, dueAt: true } } },
  });
  res.json({ data: quotes });
});

router.post("/organization/subscription/contracted-checkout", async (req: AuthRequest, res) => {
  if (req.auth?.role !== Role.SUPER_ADMIN || req.auth.homeOrganizationId !== req.auth.organizationId || req.auth.organizationId === "org_default")
    throw new AppError(403, "TENANT_BILLING_ADMIN_REQUIRED", "Customer tenant administrator required");
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET)
    throw new AppError(503, "PAYMENT_UNAVAILABLE", "Razorpay checkout has not been configured");
  const { quoteId } = checkoutInput.parse(req.body);
  const organizationId = req.auth.organizationId;
  const initialQuote = await systemPrisma.schoolOSQuotation.findUnique({
    where: { id: quoteId }, select: { organizationId: true, planCode: true },
  });
  if (!initialQuote || initialQuote.organizationId !== organizationId)
    throw new AppError(404, "SCHOOLOS_QUOTE_NOT_FOUND", "No contracted quotation for this organization");
  const capacityPlan = await systemPrisma.saaSPlan.findUnique({ where: { code: initialQuote.planCode } });
  if (!capacityPlan) throw new AppError(404, "SAAS_PLAN_NOT_FOUND", "Plan is unavailable");
  await assertCommercialPlanFitsUsage(organizationId, capacityPlan.limits);

  const invoice = await systemPrisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"schoolos-organization-checkout:" + organizationId}))`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"schoolos-quote-checkout:" + quoteId}))`;
    const quote = await tx.schoolOSQuotation.findUnique({
      where: { id: quoteId }, include: { contractDocument: { include: { lead: { select: { wonOrganizationId: true } } } } },
    });
    if (!quote || quote.organizationId !== organizationId)
      throw new AppError(404, "SCHOOLOS_QUOTE_NOT_FOUND", "No quotation for this organization");
    const [plan, organization, existing] = await Promise.all([
      tx.saaSPlan.findUnique({ where: { code: quote.planCode } }),
      tx.organization.findUnique({ where: { id: organizationId } }),
      tx.saaSInvoice.findUnique({ where: { schoolOSQuoteId: quoteId } }),
    ]);
    if (!organization || organization.deletedAt || !organization.isActive)
      throw new AppError(409, "SCHOOLOS_CUSTOMER_NOT_ACTIVE", "Customer organization is not active");
    if (existing?.organizationId !== undefined && existing.organizationId !== organizationId)
      throw new AppError(409, "SCHOOLOS_INVOICE_TENANT_MISMATCH", "Existing invoice belongs to a different tenant");
    if (existing?.providerOrderId && quote.status !== "PAYMENT_PENDING")
      throw new AppError(409, "SCHOOLOS_QUOTE_STATE_CONFLICT", "Payment order state is incomplete; manual reconciliation required");
    const amount = validateSchoolOSBaseQuoteCheckout(
      quote, plan, quote.contractDocument, organizationId, new Date(), Boolean(existing?.providerOrderId),
    );
    if (!existing) {
      const otherUnpaid = await tx.saaSInvoice.findFirst({
        where: { organizationId, schoolOSQuoteId: { not: null }, status: SaaSInvoiceStatus.OPEN },
        select: { id: true, invoiceNo: true },
      });
      if (otherUnpaid) throw new AppError(409, "SCHOOLOS_TENANT_CHECKOUT_PENDING", "Another signed quote has an open payment invoice; reconcile it before a new quote checkout");
    }
    if (existing) {
      if (existing.status === SaaSInvoiceStatus.PAID)
        throw new AppError(409, "SCHOOLOS_QUOTE_ALREADY_PAID", "This contracted quotation is already paid");
      if (existing.status !== SaaSInvoiceStatus.OPEN || !existing.providerOrderId)
        throw new AppError(409, "SCHOOLOS_CHECKOUT_RECONCILIATION_REQUIRED", "A prior order attempt requires manual reconciliation before retry");
      if (existing.planId !== plan!.id || existing.totalPaise !== amount.totalPaise || existing.currency !== "INR"
        || !existing.dueAt || existing.dueAt.getTime() <= Date.now())
        throw new AppError(409, "SCHOOLOS_INVOICE_CHANGED", "Linked invoice has expired or changed");
      return existing;
    }

    const currentPlan = await tx.saaSPlan.findUnique({ where: { code: organization.subscriptionPlan } });
    const subscription = await tx.saaSSubscription.upsert({
      where: { organizationId },
      create: {
        organizationId, planId: currentPlan?.id ?? plan!.id,
        status: organization.subscriptionStatus || OrganizationSubscriptionStatus.TRIAL,
        billingCycle: SaaSBillingCycle.ANNUAL,
      },
      update: {},
    });
    const periodStart = new Date();
    const periodEnd = addYear(periodStart);
    const invoiceNo = `SOI-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    return tx.saaSInvoice.create({
      data: {
        organizationId, subscriptionId: subscription.id, planId: plan!.id,
        schoolOSQuoteId: quoteId, invoiceNo, checkoutKey: `schoolos:${quoteId}`,
        amountPaise: amount.baseAmountPaise, taxPaise: amount.taxPaise, totalPaise: amount.totalPaise,
        currency: "INR", status: SaaSInvoiceStatus.OPEN,
        periodStart, periodEnd, dueAt: new Date(periodStart.getTime() + 24 * 60 * 60 * 1000),
        provider: "RAZORPAY",
        metadata: { quoteId, quoteNo: quote.quoteNo, basis: "SIGNED_ANNUAL_BASE_PLAN", billingCycle: "ANNUAL" } as Prisma.InputJsonValue,
      },
    });
  });

  if (invoice.providerOrderId) {
    return res.json({
      data: { reused: true, quoteId, invoiceId: invoice.id, keyId: env.RAZORPAY_KEY_ID,
        order: { id: invoice.providerOrderId, amount: invoice.totalPaise, currency: invoice.currency, receipt: invoice.invoiceNo } },
    });
  }

  // Intentionally fail closed on network/DB errors: if Razorpay created an order but the
  // response was lost, no second order is issued until operations reconcile the first.
  const razorpay = new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
  const order = await razorpay.orders.create({
    amount: invoice.totalPaise, currency: "INR", receipt: invoice.invoiceNo.slice(0, 40),
    notes: { organizationId, invoiceId: invoice.id, quoteId },
  });
  await systemPrisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"schoolos-quote-checkout:" + quoteId}))`;
    const saved = await tx.saaSInvoice.updateMany({
      where: { id: invoice.id, organizationId, status: SaaSInvoiceStatus.OPEN, providerOrderId: null },
      data: { providerOrderId: order.id },
    });
    if (saved.count !== 1)
      throw new AppError(409, "SCHOOLOS_INVOICE_ORDER_CONFLICT", "Payment order requires reconciliation");
    const quote = await tx.schoolOSQuotation.updateMany({
      where: { id: quoteId, organizationId, status: "CONTRACTED" },
      data: { status: "PAYMENT_PENDING", version: { increment: 1 } },
    });
    if (quote.count !== 1)
      throw new AppError(409, "SCHOOLOS_QUOTE_STATE_CONFLICT", "Quoted purchase state changed");
    const current = await tx.schoolOSQuotation.findUniqueOrThrow({ where: { id: quoteId } });
    await tx.schoolOSQuotationRevision.create({
      data: { quoteId, version: current.version, action: "CHECKOUT_ORDER_CREATED", actorId: req.auth!.userId,
        snapshot: { invoiceId: invoice.id, providerOrderId: order.id, totalPaise: invoice.totalPaise } as Prisma.InputJsonValue },
    });
    await tx.auditLog.create({
      data: { organizationId, actorId: req.auth!.userId, action: "SCHOOLOS_CONTRACT_CHECKOUT_CREATED",
        entity: "SaaSInvoice", entityId: invoice.id,
        metadata: { quoteId, providerOrderId: order.id, totalPaise: invoice.totalPaise } },
    });
  });
  res.status(201).json({ data: { reused: false, quoteId, invoiceId: invoice.id, keyId: env.RAZORPAY_KEY_ID, order } });
});

export default router;
