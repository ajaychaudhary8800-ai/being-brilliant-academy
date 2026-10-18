import assert from "node:assert/strict";
import test from "node:test";
import { reconcileSchoolOSPricing, SCHOOL_OS_COMMERCIAL_REFERENCE, schoolOSExternalQuoteReady } from "./schoolos-pricing-reconciliation.js";

test("approved rate reference records tier prices in paise without mutating SaaS plan", () => {
  assert.equal(SCHOOL_OS_COMMERCIAL_REFERENCE.tiers.ESSENTIALS.annualPaise, 4990000);
  assert.equal(SCHOOL_OS_COMMERCIAL_REFERENCE.tiers.GROWTH.annualPaise, 9990000);
  assert.equal(SCHOOL_OS_COMMERCIAL_REFERENCE.tiers.PROFESSIONAL.annualPaise, 14999000);
  assert.equal(SCHOOL_OS_COMMERCIAL_REFERENCE.tiers.ENTERPRISE.annualPaise, null);
  assert.equal(SCHOOL_OS_COMMERCIAL_REFERENCE.pilot.amountPaise, 1499900);
});

test("detects existing September price drift before external issue", () => {
  const g = reconcileSchoolOSPricing("GROWTH", { code: "GROWTH", annualPricePaise: 8999000, taxRateBps: 1800, currency: "INR", isActive: true });
  assert.equal(g.status, "RECONCILIATION_REQUIRED");
  assert.ok(g.issues.some(message => message.includes("-991000")));
});

test("aligned, custom and inactive pricing are not silently conflated", () => {
  assert.equal(reconcileSchoolOSPricing("ESSENTIALS", { code: "ESSENTIALS", annualPricePaise: 4990000, taxRateBps: 1800, currency: "INR", isActive: true }).status, "ALIGNED");
  assert.equal(reconcileSchoolOSPricing("ENTERPRISE", { code: "ENTERPRISE", annualPricePaise: 29999000, taxRateBps: 1800, currency: "INR", isActive: true }).status, "CUSTOM_QUOTE_REQUIRED");
  assert.equal(reconcileSchoolOSPricing("ESSENTIALS", { code: "ESSENTIALS", annualPricePaise: 4990000, taxRateBps: 1800, currency: "INR", isActive: false }).status, "RECONCILIATION_REQUIRED");
  assert.equal(reconcileSchoolOSPricing("GROWTH", null).status, "PLAN_NOT_FOUND");
});

test("approved quote cannot activate access without future payment and acceptance", () => {
  const aligned = reconcileSchoolOSPricing("PROFESSIONAL", { code: "PROFESSIONAL", annualPricePaise: 14999000, taxRateBps: 1800, currency: "INR", isActive: true });
  const ready = schoolOSExternalQuoteReady({ quoteStatus: "INTERNALLY_APPROVED", validUntil: new Date("2027-02-01T00:00:00Z"), clientOrganizationId: "tenant-1", planResult: aligned, today: new Date("2026-10-18T12:00:00Z") });
  assert.equal(ready.commercialReviewReady, true);
  assert.equal(ready.activationAllowed, false);
  const unready = schoolOSExternalQuoteReady({ quoteStatus: "DRAFT", validUntil: new Date("2026-10-01T00:00:00Z"), clientOrganizationId: null, planResult: aligned });
  assert.equal(unready.commercialReviewReady, false);
  assert.equal(unready.activationAllowed, false);
});
