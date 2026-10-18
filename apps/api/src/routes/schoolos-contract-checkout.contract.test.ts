import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("contract payment checkout is explicitly tenant-scoped and payable only for an exact signed quote", async () => {
  const route = await readFile(new URL("schoolos-contract-checkout.ts", import.meta.url), "utf8");
  const policy = await readFile(new URL("../lib/schoolos-contract-payment-policy.ts", import.meta.url), "utf8");
  assert.match(route, /req\.auth\.organizationId === "org_default"/);
  assert.match(route, /initialQuote\.organizationId !== organizationId/);
  assert.match(route, /validateSchoolOSBaseQuoteCheckout/);
  assert.match(policy, /document\.uploadedById === document\.verifiedById/);
  assert.match(policy, /quote\.items\.length !== 0 \|\| quote\.discountBps !== 0/);
  assert.match(policy, /SCHOOLOS_QUOTE_TENANT_MISMATCH/);
  assert.match(policy, /SCHOOLOS_PRICING_REVIEW_REQUIRED/);
  assert.match(policy, /SCHOOLOS_QUOTE_PRICE_CHANGED/);
});

test("quote invoice and provider order are unique, idempotent and not prematurely activated", async () => {
  const route = await readFile(new URL("schoolos-contract-checkout.ts", import.meta.url), "utf8");
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = await readFile(new URL("../../prisma/migrations/20261018210000_schoolos_quoted_saas_checkout/migration.sql", import.meta.url), "utf8");
  assert.match(route, /pg_advisory_xact_lock/);
  assert.match(route, /schoolOSQuoteId: quoteId/);
  assert.match(route, /providerOrderId: null/);
  assert.match(route, /SCHOOLOS_CHECKOUT_RECONCILIATION_REQUIRED/);
  assert.match(route, /PAYMENT_PENDING/);
  assert.match(route, /quote\.count !== 1/);
  assert.doesNotMatch(route, /subscriptionStatus: OrganizationSubscriptionStatus\.ACTIVE/);
  assert.doesNotMatch(route, /saasSubscription\.update\(/);
  assert.match(schema, /schoolOSQuoteId\s+String\?\s+@unique/);
  assert.match(migration, /CREATE UNIQUE INDEX "SaaSInvoice_schoolOSQuoteId_key"/);
  assert.doesNotMatch(migration, /ALTER TABLE "SaaSSubscription"/);
});

test("only a verified capture can activate quoted plan, and webhook remains signature-checked", async () => {
  const policy = await readFile(new URL("../lib/saas-commercial.ts", import.meta.url), "utf8");
  const payments = await readFile(new URL("payments.ts", import.meta.url), "utf8");
  const vault = await readFile(new URL("commercial-document-vault.ts", import.meta.url), "utf8");
  assert.match(policy, /invoice\.schoolOSQuoteId/);
  assert.match(policy, /quote\.status !== "PAYMENT_PENDING"/);
  assert.match(policy, /payment\.amount !== invoice\.totalPaise/);
  assert.match(policy, /quotedSettings = \{ \.\.\.settings, commercialEntitlements: \{ \.\.\.commercial, enforce: true \} \}/);
  assert.match(policy, /action: "VERIFIED_PAYMENT_CAPTURED"/);
  assert.match(policy, /SCHOOLOS_CONTRACT_PAYMENT_CAPTURED/);
  assert.match(payments, /razorpay-signature/);
  assert.match(payments, /captureSaaSRazorpayPayment\(payment, event\)/);
  assert.match(vault, /Contracted signed evidence cannot be reverified/);
  assert.match(vault, /This signed order form is bound to a quotation and cannot be archived/);
});

test("billing recovery permits signed quote checkout without opening other restricted routes", async () => {
  const auth = await readFile(new URL("../middleware/auth.ts", import.meta.url), "utf8");
  assert.match(auth, /subscription\/contracted-checkout/);
  assert.match(auth, /BILLING_RECOVERY_ROUTE_BLOCKED/);
});
