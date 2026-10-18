import assert from "node:assert/strict";
import test from "node:test";
import { validateSchoolOSBaseQuoteCheckout } from "./schoolos-contract-payment-policy.js";
import { AppError } from "./http.js";
const now = new Date("2026-10-18T12:00:00Z");
const org = "client-a";
const plan = { id: "growth-plan", code: "GROWTH", annualPricePaise: 9990000, taxRateBps: 1800, currency: "INR", isActive: true };
const tax = 1798200;
const quote = {
  id: "quote-id", quoteNo: "SO5-20261018-TEST", organizationId: org,
  status: "CONTRACTED", billingCycle: "ANNUAL", planCode: plan.code, validUntil: new Date("2026-11-20T00:00:00Z"),
  totalPaise: plan.annualPricePaise + tax, subtotalPaise: plan.annualPricePaise, taxPaise: tax,
  discountBps: 0, items: [], contractDocumentId: "doc-1",
  pricingSnapshot: { pricing: { totalPaise: plan.annualPricePaise + tax },
    rateCardSnapshot: { planId: plan.id, planCode: plan.code, currency: "INR", billingCycle: "ANNUAL",
      basePricePaise: plan.annualPricePaise, taxRateBps: 1800 } },
};
const document = { id: "doc-1", documentType: "SIGNED_ORDER_FORM", documentReference: quote.quoteNo,
  organizationId: org, verificationStatus: "VERIFIED", archivedAt: null,
  signedAt: new Date("2026-10-18T00:00:00Z"), verifiedAt: new Date("2026-10-18T01:00:00Z"),
  verifiedById: "reviewer", uploadedById: "uploader", lead: { wonOrganizationId: org } };
const code = (fn: () => unknown, expected: string) =>
  assert.throws(fn, e => e instanceof AppError && e.code === expected);

test("signed and matched annual base quote can be prepared for payment", () => {
  const result = validateSchoolOSBaseQuoteCheckout(quote, plan, document, org, now);
  assert.equal(result.totalPaise, 11788200);
  assert.equal(result.taxPaise, tax);
});
test("cross-tenant, unapproved, expired and stale-price settlement is rejected", () => {
  code(() => validateSchoolOSBaseQuoteCheckout(quote, plan, document, "client-b", now), "SCHOOLOS_QUOTE_TENANT_MISMATCH");
  code(() => validateSchoolOSBaseQuoteCheckout({ ...quote, status: "DRAFT" }, plan, document, org, now), "SCHOOLOS_QUOTE_NOT_CONTRACTED");
  code(() => validateSchoolOSBaseQuoteCheckout({ ...quote, validUntil: new Date("2026-10-01") }, plan, document, org, now), "SCHOOLOS_QUOTE_EXPIRED");
  code(() => validateSchoolOSBaseQuoteCheckout(quote, { ...plan, annualPricePaise: 8999000 }, document, org, now), "SCHOOLOS_PRICING_REVIEW_REQUIRED");
});
test("no discount, custom module, or independently unverified order is ever silently activated", () => {
  code(() => validateSchoolOSBaseQuoteCheckout({ ...quote, discountBps: 500 }, plan, document, org, now), "SCHOOLOS_CUSTOM_QUOTE_CHECKOUT_UNSUPPORTED");
  code(() => validateSchoolOSBaseQuoteCheckout({ ...quote, items: [{ category: "MODULE", code: "lms" }] }, plan, document, org, now), "SCHOOLOS_CUSTOM_QUOTE_CHECKOUT_UNSUPPORTED");
  code(() => validateSchoolOSBaseQuoteCheckout(quote, plan, { ...document, verifiedById: "uploader" }, org, now), "SCHOOLOS_CONTRACT_EVIDENCE_INVALID");
  code(() => validateSchoolOSBaseQuoteCheckout(quote, plan, { ...document, lead: { wonOrganizationId: "other" } }, org, now), "SCHOOLOS_CONTRACT_EVIDENCE_INVALID");
});
test("idempotent order reuse can preserve earlier valid quote but cannot change customer or price", () => {
  assert.equal(validateSchoolOSBaseQuoteCheckout({ ...quote, status: "PAYMENT_PENDING", validUntil: new Date("2026-10-15") }, plan, document, org, now, true).totalPaise, 11788200);
  code(() => validateSchoolOSBaseQuoteCheckout({ ...quote, status: "PAYMENT_PENDING" }, plan, document, org, now), "SCHOOLOS_QUOTE_NOT_CONTRACTED");
});
