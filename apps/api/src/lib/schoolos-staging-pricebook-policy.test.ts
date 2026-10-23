import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { FIXED_V5_PLANS, assertV5StagingPricebookTarget, stagingPricebookPlan, type StagingPlanSnapshot } from "./schoolos-staging-pricebook-policy.js";

const snapshot = (): StagingPlanSnapshot[] => FIXED_V5_PLANS.map((code, index) => ({
  id: "plan-" + code, code, annualPricePaise: [4_999_000, 8_999_000, 14_999_000][index]!,
  currency: "INR", taxRateBps: 1800, isActive: true,
  unresolvedQuotes: 0, paidInvoices: 0, outstandingInvoices: 0,
}));

test("approved fixed-tier staging plan pinpoints Essentials and Growth drift without touching Professional", () => {
  const result = stagingPricebookPlan(snapshot());
  assert.deepEqual(result.map(x => [x.planCode, x.status]), [
    ["ESSENTIALS", "CHANGE_SAFE"], ["GROWTH", "CHANGE_SAFE"], ["PROFESSIONAL", "ALIGNED"],
  ]);
  assert.equal(result[0]?.previousPaise, 4_999_000);
  assert.equal(result[0]?.proposedPaise, 4_990_000);
  assert.equal(result[1]?.previousPaise, 8_999_000);
  assert.equal(result[1]?.proposedPaise, 9_990_000);
});

test("missing plan, signed or pending approved quote, PAID invoice and tax drift fail closed", () => {
  const base = snapshot();
  assert.equal(stagingPricebookPlan(base.filter(x => x.code !== "ESSENTIALS"))[0]?.status, "BLOCKED");
  assert.equal(stagingPricebookPlan(base.map(x => x.code === "GROWTH" ? { ...x, unresolvedQuotes: 1 } : x))[1]?.status, "BLOCKED");
  assert.equal(stagingPricebookPlan(base.map(x => x.code === "ESSENTIALS" ? { ...x, paidInvoices: 1 } : x))[0]?.status, "BLOCKED");
  assert.equal(stagingPricebookPlan(base.map(x => x.code === "ESSENTIALS" ? { ...x, outstandingInvoices: 1 } : x))[0]?.status, "BLOCKED");
  assert.equal(stagingPricebookPlan(base.map(x => x.code === "GROWTH" ? { ...x, taxRateBps: 0 } : x))[1]?.status, "BLOCKED");
  assert.equal(stagingPricebookPlan(base.map(x => x.code === "GROWTH" ? { ...x, isActive: false } : x))[1]?.status, "BLOCKED");
});

test("historical PAID Professional invoice never blocks unrelated Essentials or Growth repricing", () => {
  const plans = snapshot().map(plan => plan.code === "PROFESSIONAL"
    ? { ...plan, paidInvoices: 2, outstandingInvoices: 1, unresolvedQuotes: 1 }
    : plan);
  assert.deepEqual(stagingPricebookPlan(plans).map(action => [action.planCode, action.status]), [
    ["ESSENTIALS", "CHANGE_SAFE"],
    ["GROWTH", "CHANGE_SAFE"],
    ["PROFESSIONAL", "ALIGNED"],
  ]);
  const aligned = stagingPricebookPlan(plans)[2]!;
  assert.deepEqual(aligned.reasons, [], "No historical invoicing changes are proposed or needed");
});

test("only affected mispriced tier is blocked by existing contracted or paid state", () => {
  const plans = snapshot().map(plan => {
    if (plan.code === "ESSENTIALS") return { ...plan, paidInvoices: 1 };
    if (plan.code === "PROFESSIONAL") return { ...plan, paidInvoices: 5 };
    return plan;
  });
  assert.deepEqual(stagingPricebookPlan(plans).map(action => [action.planCode, action.status]), [
    ["ESSENTIALS", "BLOCKED"],
    ["GROWTH", "CHANGE_SAFE"],
    ["PROFESSIONAL", "ALIGNED"],
  ]);
  assert.match(stagingPricebookPlan(plans)[0]!.reasons.join("; "), /PAID invoices/);
});

test("aligned plan with prior invoices must still be active and use approved INR GST", () => {
  const plans = snapshot().map(plan => plan.code === "PROFESSIONAL"
    ? { ...plan, paidInvoices: 3, currency: "USD" }
    : plan);
  assert.equal(stagingPricebookPlan(plans)[2]?.status, "BLOCKED");
  const doubleProfessional = [...snapshot(), { ...snapshot()[2]!, id: "duplicate-professional" }];
  assert.equal(stagingPricebookPlan(doubleProfessional)[2]?.status, "BLOCKED");
  const previouslyPaidEssentials = snapshot().map(plan => plan.code === "ESSENTIALS"
    ? { ...plan, annualPricePaise: 4_990_000, paidInvoices: 4 }
    : plan);
  assert.equal(stagingPricebookPlan(previouslyPaidEssentials)[0]?.status, "ALIGNED");
});

test("script rejects V4 production, non-staging DB, live payment mode and unauthorized apply", () => {
  const staging = {
    DATABASE_URL: "postgresql://placeholder:placeholder@127.0.0.1:5432/schoolos_v5_staging",
    WEB_URL: "https://v5-staging.beingbrilliantedu.com",
    RAZORPAY_MODE: "test",
  };
  assert.doesNotThrow(() => assertV5StagingPricebookTarget(staging, false));
  assert.throws(() => assertV5StagingPricebookTarget(staging, true), /PRICEBOOK_APPLY_NOT_AUTHORIZED/);
  assert.doesNotThrow(() => assertV5StagingPricebookTarget({
    ...staging, SCHOOLOS_V5_STAGING_PRICEBOOK_APPLY: "APPROVED-2026-10-18-V5-STAGING-ONLY",
  }, true));
  assert.throws(() => assertV5StagingPricebookTarget({
    ...staging, GITHUB_ACTIONS: "true", SCHOOLOS_V5_STAGING_PRICEBOOK_APPLY: "APPROVED-2026-10-18-V5-STAGING-ONLY",
  }, true), /PRICEBOOK_APPLY_NOT_AUTHORIZED/);
  for (const changed of [
    { DATABASE_URL: "postgresql://x:y@127.0.0.1:5432/bba_production" },
    { WEB_URL: "https://beingbrilliantedu.com" },
    { RAZORPAY_MODE: "live" },
  ]) assert.throws(() => assertV5StagingPricebookTarget({ ...staging, ...changed }, false), /PRICEBOOK_TARGET_NOT_ISOLATED_V5_STAGING/);
});

test("staging repricing records a transactionally paired audit and never rewrites customer contracts", async () => {
  const script = await readFile(new URL("../scripts/schoolos-v5-staging-pricebook.ts", import.meta.url), "utf8");
  assert.match(script, /tx\.auditLog\.create\(/);
  assert.match(script, /SCHOOLOS_V5_STAGING_PRICEBOOK_APPLIED/);
  assert.match(script, /financeSignoffRecorded: false/);
  assert.doesNotMatch(script, /tx\.schoolOSQuotation\.(?:update|delete|upsert)/);
  assert.doesNotMatch(script, /tx\.saaSInvoice\.(?:update|delete|upsert)/);
});
