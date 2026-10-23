import "express-async-errors";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { OrganizationSubscriptionStatus, Role, SaaSBillingCycle, SaaSInvoiceStatus } from "@prisma/client";
import express from "express";
import jwt from "jsonwebtoken";
import { env } from "../config.js";
import { errorHandler } from "../lib/http.js";
import { systemPrisma } from "../lib/prisma.js";
import { captureSaaSRazorpayPayment } from "../lib/saas-commercial.js";
import contractRouter from "../routes/schoolos-contract-checkout.js";
import paymentsRouter from "../routes/payments.js";

/**
 * Disposable PostgreSQL HTTP integration. Only tests reuse of an existing
 * synthetic provider order: NEVER creates Razorpay orders or claims a real
 * customer has signed a contract. No external staging/production access.
 */
function assertLocalSyntheticTarget() {
  const raw = process.env.TEST_DATABASE_URL;
  let db: URL | undefined;
  try { db = raw ? new URL(raw) : undefined; } catch { /* fail closed */ }
  const name = db?.pathname.replace(/^\//, "") ?? "";
  if (process.env.RUN_POSTGRES_INTEGRATION !== "1" || !raw || raw !== process.env.DATABASE_URL
    || !db || !["postgres:", "postgresql:"].includes(db.protocol)
    || !["127.0.0.1", "localhost", "::1"].includes(db.hostname)
    || !/(^|[_-])(test|integration)([_-]|$)/i.test(name)
    || process.env.RAZORPAY_MODE !== "test"
    || !process.env.RAZORPAY_KEY_ID?.startsWith("rzp_test_")
    || !process.env.RAZORPAY_KEY_SECRET?.startsWith("synthetic-")
    || process.env.RAZORPAY_WEBHOOK_SECRET !== "synthetic-local-webhook-only") {
    throw new Error("Refusing quote HTTP QA without isolated local PostgreSQL and synthetic TEST provider credentials");
  }
}

test("signed-quote HTTP retry is tenant-bound, invoice-stable and never creates another provider order", {
  // Generic API CI does not provide synthetic billing credentials.
  // The isolated V5 sandbox job opts into this exact local-only fixture.
  skip: process.env.RUN_POSTGRES_INTEGRATION !== "1"
    || process.env.RAZORPAY_KEY_ID !== "rzp_test_synthetic_disposable_only"
    || process.env.RAZORPAY_KEY_SECRET !== "synthetic-local-only-nonsecret"
    || process.env.RAZORPAY_WEBHOOK_SECRET !== "synthetic-local-webhook-only",
  timeout: 120_000,
}, async () => {
  assertLocalSyntheticTarget();
  const unique = crypto.randomUUID().replaceAll("-", "").slice(0, 18);
  const customerId = "qa-contract-" + unique;
  const otherId = "qa-other-" + unique;
  const orderId = "order_synthetic_" + unique;
  const invoiceNo = "QA-SOI-" + unique;
  const quoteNo = "QA-SO5-" + unique;
  const validUntil = new Date(Date.now() + 10 * 86400_000);
  const dueAt = new Date(Date.now() + 86400_000);
  const termStart = new Date(Date.now() - 3600_000);
  const termEnd = new Date(Date.now() + 365 * 86400_000);
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
  let leadId: string | undefined;
  let documentId: string | undefined;
  let invoiceId: string | undefined;
  let originalEssentialsPricePaise: number | undefined;

  try {
    const seeded = await systemPrisma.saaSPlan.findUniqueOrThrow({ where: { code: "ESSENTIALS" } });
    // V4 migration fixture still seeds Essentials at ₹49,990 while the
    // approved V5 reference is ₹49,900. Reconcile only this disposable CI
    // database to exercise a valid signed-quote policy, then restore it.
    originalEssentialsPricePaise = seeded.annualPricePaise;
    if (seeded.annualPricePaise !== 4_990_000) {
      await systemPrisma.saaSPlan.update({
        where: { id: seeded.id }, data: { annualPricePaise: 4_990_000 },
      });
    }
    const plan = await systemPrisma.saaSPlan.findUniqueOrThrow({ where: { id: seeded.id } });
    assert.equal(plan.annualPricePaise, 4_990_000);
    assert.equal(plan.taxRateBps, 1800);
    const taxPaise = Math.round(plan.annualPricePaise * plan.taxRateBps / 10_000);
    const totalPaise = plan.annualPricePaise + taxPaise;

    await systemPrisma.organization.createMany({
      data: [
        { id: customerId, slug: customerId, name: "Synthetic checkout customer", email: customerId + "@example.test",
          subscriptionStatus: OrganizationSubscriptionStatus.ACTIVE, subscriptionPlan: plan.code,
          subscriptionEndsAt: termEnd },
        { id: otherId, slug: otherId, name: "Synthetic foreign customer", email: otherId + "@example.test",
          subscriptionStatus: OrganizationSubscriptionStatus.ACTIVE, subscriptionPlan: plan.code,
          subscriptionEndsAt: termEnd },
      ],
    });
    const [owner, foreign] = await Promise.all([
      systemPrisma.user.create({ data: { organizationId: customerId,
        name: "Synthetic purchaser", email: "qa-contract-owner-" + unique + "@example.test",
        role: Role.SUPER_ADMIN, passwordHash: "not-a-real-password" } }),
      systemPrisma.user.create({ data: { organizationId: otherId,
        name: "Synthetic foreign administrator", email: "qa-contract-foreign-" + unique + "@example.test",
        role: Role.SUPER_ADMIN, passwordHash: "not-a-real-password" } }),
    ]);

    const subscription = await systemPrisma.saaSSubscription.create({ data: {
      organizationId: customerId, planId: plan.id,
      status: OrganizationSubscriptionStatus.ACTIVE, billingCycle: SaaSBillingCycle.ANNUAL,
    } });
    const lead = await systemPrisma.saaSSalesLead.create({ data: {
      organizationName: "Synthetic checkout customer", contactName: "QA fictional person",
      mobile: "0000000000", institutionType: "COACHING", status: "WON",
      wonOrganizationId: customerId, source: "SYNTHETIC_INTEGRATION_TEST",
    } });
    leadId = lead.id;
    // Deliberately fabricated metadata in an isolated disposable database;
    // this must NEVER be inserted into an actual staging/production vault.
    const document = await systemPrisma.saaSCommercialDocument.create({ data: {
      leadId: lead.id, organizationId: customerId, documentType: "SIGNED_ORDER_FORM",
      documentReference: quoteNo, signedAt: new Date(),
      fileName: "synthetic-not-customer-evidence.pdf", mimeType: "application/pdf", fileSize: 18,
      encryptedFileData: Buffer.from("synthetic-test-only"),
      contentSha256: crypto.createHash("sha256").update("synthetic-test-only").digest("hex"),
      verificationStatus: "VERIFIED", verifiedAt: new Date(),
      uploadedById: "synthetic-fixture-maker", verifiedById: "synthetic-fixture-checker",
    } });
    documentId = document.id;
    const quote = await systemPrisma.schoolOSQuotation.create({ data: {
      quoteNo, organizationId: customerId, clientName: "Synthetic checkout customer",
      planCode: plan.code, billingCycle: SaaSBillingCycle.ANNUAL, status: "PAYMENT_PENDING",
      validUntil, contractDocumentId: document.id, items: [],
      pricingSnapshot: { pricing: { totalPaise }, rateCardSnapshot: {
        planId: plan.id, planCode: plan.code, currency: "INR", billingCycle: "ANNUAL",
        basePricePaise: plan.annualPricePaise, taxRateBps: plan.taxRateBps,
      } },
      subtotalPaise: plan.annualPricePaise, discountBps: 0, discountPaise: 0,
      taxRateBps: plan.taxRateBps, taxPaise, totalPaise,
      createdBy: owner.id, updatedBy: owner.id,
    } });
    const invoice = await systemPrisma.saaSInvoice.create({ data: {
      organizationId: customerId, subscriptionId: subscription.id, planId: plan.id,
      schoolOSQuoteId: quote.id, invoiceNo, checkoutKey: "schoolos:" + quote.id,
      status: SaaSInvoiceStatus.OPEN, amountPaise: plan.annualPricePaise,
      taxPaise, totalPaise, currency: "INR", provider: "RAZORPAY",
      providerOrderId: orderId, periodStart: termStart, periodEnd: termEnd, dueAt,
      metadata: { quoteId: quote.id, quoteNo, basis: "SIGNED_ANNUAL_BASE_PLAN",
        billingCycle: "ANNUAL", addonLines: [] },
    } });
    invoiceId = invoice.id;

    const app = express();
    // The real API mounts raw webhook bytes before its general JSON parser.
    app.use("/api/v1/payments/razorpay/webhook", express.raw({ type: "application/json" }));
    app.use(express.json());
    // The webhook must be reachable without the subscription router's auth middleware.
    app.use("/api/v1/payments", paymentsRouter);
    app.use("/api/v1", contractRouter);
    app.use(errorHandler);
    server = await new Promise<ReturnType<ReturnType<typeof express>["listen"]>>((resolve, reject) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
      listener.on("error", reject);
    });
    const origin = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
    const authorize = (userId: string, organizationId: string) => "Bearer " + jwt.sign(
      { userId, role: Role.SUPER_ADMIN, organizationId }, env.JWT_ACCESS_SECRET, { expiresIn: "15m" },
    );
    const postCheckout = async (token: string, quoteId: string) => {
      const response = await fetch(origin + "/api/v1/organization/subscription/contracted-checkout", {
        method: "POST", headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId }),
      });
      return { status: response.status, body: await response.json() as {
        data?: { reused: boolean; invoiceId: string; order: { id: string; amount: number; currency: string } };
        error?: { code: string };
      } };
    };

    const ownToken = authorize(owner.id, customerId);
    const foreignToken = authorize(foreign.id, otherId);
    const foreignAttempt = await postCheckout(foreignToken, quote.id);
    assert.equal(foreignAttempt.status, 404);
    assert.equal(foreignAttempt.body.error?.code, "SCHOOLOS_QUOTE_NOT_FOUND");

    const first = await postCheckout(ownToken, quote.id);
    assert.equal(first.status, 200);
    assert.equal(first.body.data?.reused, true);
    assert.equal(first.body.data?.invoiceId, invoiceId);
    assert.equal(first.body.data?.order.id, orderId);
    assert.equal(first.body.data?.order.amount, totalPaise);
    assert.equal(first.body.data?.order.currency, "INR");

    const retry = await postCheckout(ownToken, quote.id);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.data?.reused, true);
    assert.equal(retry.body.data?.order.id, orderId);
    assert.equal(await systemPrisma.saaSInvoice.count({ where: { schoolOSQuoteId: quote.id } }), 1);
    assert.equal((await systemPrisma.saaSInvoice.findUniqueOrThrow({ where: { id: invoiceId } })).status, "OPEN");
    assert.equal((await systemPrisma.schoolOSQuotation.findUniqueOrThrow({ where: { id: quote.id } })).status, "PAYMENT_PENDING");

    const unpaid = await systemPrisma.schoolOSQuotation.create({ data: {
      quoteNo: quoteNo + "-NOT-SIGNED", organizationId: customerId,
      clientName: "Synthetic pending approval", planCode: plan.code,
      billingCycle: SaaSBillingCycle.ANNUAL, status: "INTERNALLY_APPROVED",
      validUntil, items: [], pricingSnapshot: {}, subtotalPaise: plan.annualPricePaise,
      taxRateBps: plan.taxRateBps, taxPaise, totalPaise,
      createdBy: owner.id, updatedBy: owner.id,
    } });
    const missingContract = await postCheckout(ownToken, unpaid.id);
    assert.equal(missingContract.status, 409);
    assert.equal(missingContract.body.error?.code, "SCHOOLOS_QUOTE_NOT_CONTRACTED");
    assert.equal(await systemPrisma.saaSInvoice.count({ where: { organizationId: customerId } }), 1);

    // Exercise the actual HMAC-verified HTTP webhook with only disposable,
    // locally generated synthetic events. This does NOT certify a real Razorpay
    // signed callback, legal contract or real merchant capture.
    const payment = {
      id: "pay_synthetic_" + unique, order_id: orderId,
      amount: totalPaise, currency: "INR",
    };
    const event = { event: "payment.captured", payload: { payment: { entity: payment } } };
    const signatureFor = (payload: unknown) => crypto.createHmac(
      "sha256", "synthetic-local-webhook-only",
    ).update(JSON.stringify(payload)).digest("hex");
    const postWebhook = (payload: unknown, signature?: string) => fetch(
      origin + "/api/v1/payments/razorpay/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(signature === undefined ? {} : { "x-razorpay-signature": signature }),
        },
        body: JSON.stringify(payload),
      },
    );
    const unsigned = await postWebhook(event);
    assert.equal(unsigned.status, 400, "Unsigned webhook must be denied");
    const forged = await postWebhook(event, "0".repeat(64));
    assert.equal(forged.status, 400, "Incorrect HMAC must be denied");
    assert.equal((await systemPrisma.saaSInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
    })).status, "OPEN");
    assert.equal(await systemPrisma.saaSWebhookEvent.count({
      where: { provider: "RAZORPAY", eventKey: "payment.captured:" + payment.id },
    }), 0, "Unsigned/forged callbacks must not enter settlement");
    const mismatched = {
      ...event,
      payload: { payment: { entity: { ...payment, amount: totalPaise + 1 } } },
    };
    const amountRejected = await postWebhook(mismatched, signatureFor(mismatched));
    assert.equal(amountRejected.status, 422, "Valid HMAC cannot bypass invoice amount guard");
    assert.equal((await systemPrisma.saaSInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
    })).status, "OPEN");
    // A previously recorded FAILED payment ID is not safe to promote into a
    // capture just because it arrives with a newly signed HTTP payload.
    const reusedFailedId = "pay_failed_synthetic_" + unique;
    const conflictingPayment = { ...payment, id: reusedFailedId };
    await systemPrisma.saaSPayment.create({ data: {
      organizationId: customerId, invoiceId: invoice.id, provider: "RAZORPAY",
      providerPaymentId: reusedFailedId, amountPaise: totalPaise, currency: "INR",
      status: "FAILED",
    } });
    const conflictingEvent = { ...event, payload: { payment: { entity: conflictingPayment } } };
    const reusedFailed = await postWebhook(conflictingEvent, signatureFor(conflictingEvent));
    assert.equal(reusedFailed.status, 409, "Existing FAILED payment identity cannot become CAPTURED");
    assert.equal((await systemPrisma.saaSPayment.findUniqueOrThrow({
      where: { providerPaymentId: reusedFailedId },
    })).status, "FAILED");
    assert.equal((await systemPrisma.saaSInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
    })).status, "OPEN");
    await systemPrisma.saaSPayment.delete({ where: { providerPaymentId: reusedFailedId } });

    // Real PostgreSQL transaction race: three signed HTTP deliveries for the
    // same provider capture arrive before the first one has committed.
    // Replays must serialize before invoice status reads and all return 200.
    const concurrent = await Promise.all(Array.from({ length: 3 }, () =>
      postWebhook(event, signatureFor(event))));
    for (const result of concurrent)
      assert.equal(result.status, 200, "Concurrent identical signed captures must be idempotent");
    const replay = await postWebhook(event, signatureFor(event));
    assert.equal(replay.status, 200, "Later identical signed retry must stay idempotent");
    // A signed callback from the provider referencing an already PAID order
    // but a DIFFERENT payment ID must not be silently acknowledged as paid.
    const secondPayment = { ...payment, id: payment.id + "second" };
    const secondEvent = { ...event, payload: { payment: { entity: secondPayment } } };
    const conflictingSecond = await postWebhook(secondEvent, signatureFor(secondEvent));
    assert.equal(conflictingSecond.status, 409,
      "A different capture identity on a settled order requires finance review");

    // Nor may a replay change amount while recycling a valid captured ID.
    const alteredAmountEvent = { ...event, payload: { payment: {
      entity: { ...payment, amount: totalPaise + 1 },
    } } };
    const changedReplay = await postWebhook(alteredAmountEvent, signatureFor(alteredAmountEvent));
    assert.equal(changedReplay.status, 409,
      "A signed replay with a mismatched amount cannot reuse a paid capture");
    assert.equal(await systemPrisma.saaSPayment.count({ where: { providerPaymentId: secondPayment.id } }), 0);
    assert.equal(await systemPrisma.saaSWebhookEvent.count({ where: {
      provider: "RAZORPAY", eventKey: "payment.captured:" + secondPayment.id,
    } }), 0);

    const paidInvoice = await systemPrisma.saaSInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const paidQuote = await systemPrisma.schoolOSQuotation.findUniqueOrThrow({ where: { id: quote.id } });
    const paidOrg = await systemPrisma.organization.findUniqueOrThrow({ where: { id: customerId } });
    assert.equal(paidInvoice.status, "PAID");
    assert.equal(paidQuote.status, "PAID");
    assert.equal(paidOrg.subscriptionStatus, "ACTIVE");
    assert.equal(paidOrg.subscriptionPlan, plan.code);
    assert.equal((paidOrg.settings as { commercialEntitlements?: { enforce?: boolean } }).commercialEntitlements?.enforce, true);
    assert.equal(await systemPrisma.saaSPayment.count({ where: { providerPaymentId: payment.id } }), 1);
    assert.equal(await systemPrisma.saaSWebhookEvent.count({ where: {
      provider: "RAZORPAY", eventKey: "payment.captured:" + payment.id, processedAt: { not: null },
    } }), 1);
    assert.equal(await systemPrisma.saaSInvoice.count({ where: { organizationId: customerId } }), 1);

    console.log("SYNTHETIC_CAPTURE_SETTLEMENT_IDEMPOTENCY=PASS");
    console.log("SYNTHETIC_SIGNED_WEBHOOK_HTTP=PASS");
    console.log("SYNTHETIC_CAPTURE_REPLAY_ID_AND_AMOUNT_PROTECTION=PASS");
    console.log("SYNTHETIC_CONCURRENT_CAPTURE_ORDER_LOCK=PASS");
    console.log("SYNTHETIC_CONTRACT_ORDER_REUSE=PASS");
    console.log("SYNTHETIC_CROSS_TENANT_DENIAL=PASS");
    console.log("SYNTHETIC_UNSIGNED_QUOTE_DENIAL=PASS");
    console.log("PROVIDER_NETWORK_ORDERS_CREATED=0");
    console.log("REAL_SIGNED_CUSTOMER_EVIDENCE=NOT_TESTED");
    console.log("LIVE_SIGNED_RAZORPAY_WEBHOOK=NOT_TESTED");
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await systemPrisma.saaSWebhookEvent.deleteMany({
      where: { provider: "RAZORPAY", eventKey: "payment.captured:pay_synthetic_" + unique },
    });
    await systemPrisma.saaSPayment.deleteMany({ where: { organizationId: customerId } });
    await systemPrisma.auditLog.deleteMany({ where: { organizationId: customerId } });
    if (invoiceId) await systemPrisma.saaSInvoice.deleteMany({ where: { organizationId: customerId } });
    await systemPrisma.schoolOSQuotationRevision.deleteMany({ where: { quote: { organizationId: customerId } } });
    await systemPrisma.schoolOSQuotation.deleteMany({ where: { organizationId: customerId } });
    if (documentId) await systemPrisma.saaSCommercialDocument.deleteMany({ where: { id: documentId } });
    if (leadId) await systemPrisma.saaSSalesLead.deleteMany({ where: { id: leadId } });
    await systemPrisma.saaSSubscription.deleteMany({ where: { organizationId: customerId } });
    await systemPrisma.tenantAccessAudit.deleteMany({ where: { organizationId: { in: [customerId, otherId] } } });
    await systemPrisma.user.deleteMany({ where: { organizationId: { in: [customerId, otherId] } } });
    await systemPrisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" DISABLE TRIGGER "AcademicSession_exactly_one_current"');
      await tx.academicSession.deleteMany({ where: { organizationId: { in: [customerId, otherId] } } });
      await tx.organization.deleteMany({ where: { id: { in: [customerId, otherId] } } });
      await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" ENABLE TRIGGER "AcademicSession_exactly_one_current"');
    });
    if (originalEssentialsPricePaise !== undefined) {
      await systemPrisma.saaSPlan.update({
        where: { code: "ESSENTIALS" },
        data: { annualPricePaise: originalEssentialsPricePaise },
      });
    }
  }
});
