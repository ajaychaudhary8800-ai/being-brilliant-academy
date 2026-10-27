import assert from "node:assert/strict";
import test from "node:test";
import {
  assertV5GrowthStagingTarget,
  assertV5GrowthPriceApplyApproval,
  evaluateV5GrowthPrice,
  GROWTH_OLD_PAISE,
  GROWTH_APPROVED_PAISE,
  GROWTH_PRICE_APPROVAL,
} from "./schoolos-v5-growth-price-policy.mjs";

const staging = {
  WEB_URL: "https://v5-staging.beingbrilliantedu.com",
  DATABASE_URL: "postgresql://schoolos_v5_user:synthetic@postgres:5432/schoolos_v5_staging?schema=public",
  RAZORPAY_MODE: "test",
  SCHOOLOS_VIDEO_ADMISSION_ENABLED: "false",
  SCHOOLOS_VIDEO_SETTLEMENT_ENABLED: "false",
  SCHOOLOS_VIDEO_WEBHOOK_ENABLED: "false",
  SCHOOLOS_VIDEO_ZERO_RELEASE_ENABLED: "false",
};
const approvedPlan = (annualPricePaise) => ({
  code: "GROWTH", annualPricePaise, currency: "INR", taxRateBps: 1800, isActive: true,
});
const check = (plan, extras={}) => evaluateV5GrowthPrice({
  plan, quotes: 0, invoices: 0, subscriptions: 0, ...extras,
});

test("V5 target guard accepts only exact isolated QA database and all video finance flags OFF", () => {
  assert.equal(assertV5GrowthStagingTarget(staging), true);
  const bad = [
    { WEB_URL: "https://beingbrilliantedu.com" },
    { WEB_URL: "https://main-staging.beingbrilliantedu.com" },
    { DATABASE_URL: "postgresql://schoolos_v5_user:x@prod:5432/schoolos_v5_staging?schema=public" },
    { DATABASE_URL: "postgresql://schoolos_v5_user:x@postgres:5432/being_brilliant" },
    { DATABASE_URL: "postgresql://postgres:x@postgres:5432/schoolos_v5_staging" },
    { DATABASE_URL: "postgresql://schoolos_v5_user:x@postgres:5432/schoolos_v5_staging?schema=extra" },
    { RAZORPAY_MODE: "live" },
    { SCHOOLOS_VIDEO_ADMISSION_ENABLED: "true" },
    { SCHOOLOS_VIDEO_SETTLEMENT_ENABLED: "true" },
    { SCHOOLOS_VIDEO_WEBHOOK_ENABLED: "true" },
    { SCHOOLOS_VIDEO_ZERO_RELEASE_ENABLED: "true" },
  ];
  for (const updates of bad) assert.throws(() => assertV5GrowthStagingTarget({...staging,...updates}));
});

test("approved paise amounts remain exactly INR 99,900 and original drift INR 99,990", () => {
  assert.equal(GROWTH_APPROVED_PAISE, 9_990_000);
  assert.equal(GROWTH_OLD_PAISE, 9_999_000);
  assert.equal(check(approvedPlan(GROWTH_APPROVED_PAISE)).status, "ALIGNED_NO_CHANGE");
  assert.equal(check(approvedPlan(GROWTH_OLD_PAISE)).status, "CHANGE_SAFE_STAGING_ONLY");
});

test("unknown prices and existing quotes, invoices or subscriptions must never auto-change", () => {
  assert.equal(check(approvedPlan(9_000_000)).status, "BLOCKED_UNRECOGNIZED_PRICE");
  assert.equal(check({...approvedPlan(GROWTH_OLD_PAISE),isActive:false}).status,"BLOCKED_PLAN_CONFIGURATION");
  assert.equal(check({...approvedPlan(GROWTH_OLD_PAISE),currency:"USD"}).status,"BLOCKED_PLAN_CONFIGURATION");
  assert.equal(check(approvedPlan(GROWTH_OLD_PAISE),{quotes:1}).status,"BLOCKED_EXISTING_COMMERCIAL_DEPENDENCIES");
  assert.equal(check(approvedPlan(GROWTH_OLD_PAISE),{invoices:1}).status,"BLOCKED_EXISTING_COMMERCIAL_DEPENDENCIES");
  assert.equal(check(approvedPlan(GROWTH_OLD_PAISE),{subscriptions:1}).status,"BLOCKED_EXISTING_COMMERCIAL_DEPENDENCIES");
  assert.equal(check(approvedPlan(GROWTH_OLD_PAISE),{quotes:-1}).status,"BLOCKED_EXISTING_COMMERCIAL_DEPENDENCIES");
});

test("future mutation must have explicit identified external finance authorization", () => {
  assert.throws(() => assertV5GrowthPriceApplyApproval(staging));
  assert.throws(() => assertV5GrowthPriceApplyApproval({
    ...staging, SCHOOLOS_V5_GROWTH_PRICE_APPROVAL: GROWTH_PRICE_APPROVAL,
  }));
  assert.equal(assertV5GrowthPriceApplyApproval({
    ...staging,
    SCHOOLOS_V5_GROWTH_PRICE_APPROVAL: GROWTH_PRICE_APPROVAL,
    SCHOOLOS_V5_GROWTH_APPROVER_EMAIL: "finance@example.test",
    SCHOOLOS_V5_GROWTH_APPROVAL_REFERENCE: "V5-APPROVAL-TEST-20261027",
  }),true);
});
