import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { FIXED_V5_PLANS, assertV5StagingPricebookTarget, stagingPricebookPlan, type StagingPlanSnapshot } from "./schoolos-staging-pricebook-policy.js";

const snapshot = (): StagingPlanSnapshot[] => FIXED_V5_PLANS.map((code, index) => ({
  id: "plan-" + code, code, annualPricePaise: [4_999_000, 8_999_000, 14_999_000][index]!,
  currency: "INR", taxRateBps: 1800, isActive: true,
  existingQuotes: 0, paidInvoices: 0, outstandingInvoices: 0,
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
  assert.equal(stagingPricebookPlan(base.map(x => x.code === "GROWTH" ? { ...x, existingQuotes: 1 } : x))[1]?.status, "BLOCKED");
  assert.equal(stagingPricebookPlan(base.map(x => x.code === "ESSENTIALS" ? { ...x, paidInvoices: 1 } : x))[0]?.status, "BLOCKED");
  assert.equal(stagingPricebookPlan(base.map(x => x.code === "ESSENTIALS" ? { ...x, outstandingInvoices: 1 } : x))[0]?.status, "BLOCKED");
  assert.equal(stagingPricebookPlan(base.map(x => x.code === "GROWTH" ? { ...x, taxRateBps: 0 } : x))[1]?.status, "BLOCKED");
  assert.equal(stagingPricebookPlan(base.map(x => x.code === "GROWTH" ? { ...x, isActive: false } : x))[1]?.status, "BLOCKED");
});

test("unchanged Professional TEST billing cannot veto unrelated staging tier corrections", () => {
  // Earlier signed-quote QA generated a Professional invoice. Its historical
  // state is not touched by this maintenance script and must remain intact.
  const plans = snapshot().map(plan => plan.code === "PROFESSIONAL"
    ? { ...plan, existingQuotes: 2, paidInvoices: 1, outstandingInvoices: 1 }
    : plan);
  const actions = stagingPricebookPlan(plans);
  assert.deepEqual(actions.map(a => a.status), ["CHANGE_SAFE", "CHANGE_SAFE", "ALIGNED"]);
  assert.deepEqual(actions[2]?.reasons, []);
  assert.equal(actions[2]?.previousPaise, actions[2]?.proposedPaise);
});

test("commercial records on a tier that needs repricing still fail closed", () => {
  const base = snapshot();
  for (const field of ["existingQuotes", "paidInvoices", "outstandingInvoices"] as const) {
    const actions = stagingPricebookPlan(base.map(plan => plan.code === "ESSENTIALS"
      ? { ...plan, [field]: 1 } : plan));
    assert.equal(actions[0]?.status, "BLOCKED", field);
    assert.equal(actions[1]?.status, "CHANGE_SAFE");
    assert.equal(actions[2]?.status, "ALIGNED");
  }
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
  // Quotation statuses are strings; restricting to a hand-picked subset
  // would miss amendable DRAFT/REJECTED snapshots.
  assert.match(script, /schoolOSQuotation\.count\(\{ where: \{ planCode: plan\.code \} \}\)/);
  assert.doesNotMatch(script, /applicableQuotes|status: \{ in: applicableQuotes \}/);
  assert.match(script, /financeSignoffRecorded: false/);
  assert.doesNotMatch(script, /tx\.schoolOSQuotation\.(?:update|delete|upsert)/);
  assert.doesNotMatch(script, /tx\.saaSInvoice\.(?:update|delete|upsert)/);
});
