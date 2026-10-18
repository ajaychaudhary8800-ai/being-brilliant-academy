import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { OrganizationSubscriptionStatus, SaaSBillingCycle, SaaSInvoiceStatus } from "@prisma/client";
import { systemPrisma } from "../lib/prisma.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
function safeDatabase() {
  const value = process.env.TEST_DATABASE_URL;
  let url: URL | undefined;
  try { if (value) url = new URL(value); } catch { /* fail below */ }
  const db = url?.pathname.replace(/^\//, "") ?? "";
  if (!enabled || !url || value !== process.env.DATABASE_URL || !["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    || !["postgres:", "postgresql:"].includes(url.protocol) || !/(^|[_-])(test|integration)([_-]|$)/i.test(db))
    throw new Error("Refusing SchoolOS quote invoice testing outside isolated local TEST_DATABASE_URL");
}

test("PostgreSQL rejects duplicate quote invoices and cross-tenant invoice spoofing", { skip: !enabled, timeout: 90_000 }, async () => {
  safeDatabase();
  const unique = crypto.randomUUID().slice(0, 12);
  const a = `schoolos-quote-a-${unique}`;
  const b = `schoolos-quote-b-${unique}`;
  const planCode = `SOQA_${unique.replace(/-/g, "").toUpperCase()}`;
  let invoiceId: string | undefined;
  let quoteId: string | undefined;
  try {
    const plan = await systemPrisma.saaSPlan.create({
      data: { code: planCode, name: "SchoolOS Test Plan", currency: "INR",
        annualPricePaise: 4990000, monthlyPricePaise: 499000,
        taxRateBps: 1800, entitlements: { lms: true }, limits: { students: 300 } },
    });
    await systemPrisma.organization.create({
      data: { id: a, slug: a, name: "Quote Tenant A", email: `${a}@example.test`, subscriptionPlan: planCode, subscriptionStatus: OrganizationSubscriptionStatus.ACTIVE },
    });
    await systemPrisma.organization.create({
      data: { id: b, slug: b, name: "Quote Tenant B", email: `${b}@example.test`, subscriptionPlan: planCode, subscriptionStatus: OrganizationSubscriptionStatus.ACTIVE },
    });
    const sa = await systemPrisma.saaSSubscription.create({ data: { organizationId: a, planId: plan.id, status: OrganizationSubscriptionStatus.ACTIVE, billingCycle: SaaSBillingCycle.ANNUAL } });
    const sb = await systemPrisma.saaSSubscription.create({ data: { organizationId: b, planId: plan.id, status: OrganizationSubscriptionStatus.ACTIVE, billingCycle: SaaSBillingCycle.ANNUAL } });
    const quote = await systemPrisma.schoolOSQuotation.create({
      data: {
        organizationId: a, quoteNo: `SOQA-${unique}`, clientName: "Tenant A",
        planCode, billingCycle: SaaSBillingCycle.ANNUAL, status: "CONTRACTED",
        validUntil: new Date("2027-01-01T00:00:00Z"), items: [], pricingSnapshot: { rateCardSnapshot: { planCode } },
        subtotalPaise: 4990000, discountBps: 0, discountPaise: 0, taxRateBps: 1800,
        taxPaise: 898200, totalPaise: 5888200, createdBy: "integration", updatedBy: "integration",
      },
    });
    quoteId = quote.id;
    const invoice = await systemPrisma.saaSInvoice.create({
      data: {
        organizationId: a, subscriptionId: sa.id, planId: plan.id, schoolOSQuoteId: quote.id,
        invoiceNo: `SOQA-I-${unique}`, checkoutKey: `SOQA-K-${unique}`,
        amountPaise: 4990000, taxPaise: 898200, totalPaise: 5888200, currency: "INR",
        status: SaaSInvoiceStatus.OPEN, periodStart: new Date("2026-10-18T00:00:00Z"),
        periodEnd: new Date("2027-10-18T00:00:00Z"),
      },
    });
    invoiceId = invoice.id;
    assert.equal((await systemPrisma.schoolOSQuotation.findUnique({
      where: { id: quote.id }, include: { checkoutInvoice: true },
    }))?.checkoutInvoice?.id, invoice.id);

    await assert.rejects(() => systemPrisma.saaSInvoice.create({
      data: {
        organizationId: a, subscriptionId: sa.id, planId: plan.id, schoolOSQuoteId: quote.id,
        invoiceNo: `SOQA-DUP-${unique}`, amountPaise: 4990000,
        taxPaise: 898200, totalPaise: 5888200, periodStart: new Date("2026-10-18"),
        periodEnd: new Date("2027-10-18"),
      },
    }), "same signed quote must never get two invoices");

    // A quote owned by Tenant A must be rejected when Tenant B tries to
    // attach it to a foreign invoice, even through direct Prisma/database writes.
    const spoofQuote = await systemPrisma.schoolOSQuotation.create({
      data: {
        organizationId: a, quoteNo: `SOQA-X-${unique}`, clientName: "Tenant A",
        planCode, billingCycle: SaaSBillingCycle.ANNUAL, status: "CONTRACTED",
        validUntil: new Date("2027-01-01T00:00:00Z"), items: [], pricingSnapshot: {},
        subtotalPaise: 4990000, discountBps: 0, discountPaise: 0,
        taxRateBps: 1800, taxPaise: 898200, totalPaise: 5888200,
        createdBy: "integration", updatedBy: "integration",
      },
    });
    await assert.rejects(() => systemPrisma.saaSInvoice.create({
      data: {
        organizationId: b, subscriptionId: sb.id, planId: plan.id, schoolOSQuoteId: spoofQuote.id,
        invoiceNo: `SOQA-SPOOF-${unique}`, amountPaise: 4990000,
        taxPaise: 898200, totalPaise: 5888200, periodStart: new Date("2026-10-18"),
        periodEnd: new Date("2027-10-18"),
      },
    }), "foreign tenant invoice must be rejected by PostgreSQL guard");
    assert.equal(await systemPrisma.saaSInvoice.count({ where: { schoolOSQuoteId: quote.id } }), 1);
    assert.equal(await systemPrisma.saaSInvoice.count({ where: { schoolOSQuoteId: spoofQuote.id } }), 0);
  } finally {
    if (invoiceId) await systemPrisma.saaSInvoice.deleteMany({ where: { id: invoiceId } });
    await systemPrisma.schoolOSQuotationRevision.deleteMany({ where: { quote: { organizationId: a } } });
    await systemPrisma.schoolOSQuotation.deleteMany({ where: { organizationId: a } });
    await systemPrisma.saaSSubscription.deleteMany({ where: { organizationId: { in: [a, b] } } });
    for (const id of [a, b]) {
      await systemPrisma.$transaction(async tx => {
        await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" DISABLE TRIGGER "AcademicSession_exactly_one_current"');
        await tx.academicSession.deleteMany({ where: { organizationId: id } });
        await tx.organization.deleteMany({ where: { id } });
        await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" ENABLE TRIGGER "AcademicSession_exactly_one_current"');
      });
    }
    await systemPrisma.saaSPlan.deleteMany({ where: { code: planCode } });
  }
});
