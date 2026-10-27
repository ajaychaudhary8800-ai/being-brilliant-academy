import test from "node:test";
import assert from "node:assert/strict";
import {
  GROWTH_APPROVED_PAISE, GROWTH_OLD_PAISE,
  assertV5GrowthStagingTarget, assertV5GrowthPriceApplyApproval,
  evaluateV5GrowthPrice,
} from "./schoolos-v5-growth-price-policy.mjs";
import {reconcileV5GrowthStaging} from "./schoolos-v5-growth-price-reconcile.mjs";

const env = Object.freeze({
  WEB_URL: "https://v5-staging.beingbrilliantedu.com",
  DATABASE_URL: "postgresql://schoolos_v5_user:never-a-real-password@postgres:5432/schoolos_v5_staging?schema=public",
  RAZORPAY_MODE: "test",
  SCHOOLOS_VIDEO_ADMISSION_ENABLED: "false",
  SCHOOLOS_VIDEO_SETTLEMENT_ENABLED: "false",
  SCHOOLOS_VIDEO_ZERO_RELEASE_ENABLED: "false",
  SCHOOLOS_VIDEO_WEBHOOK_ENABLED: "false",
  SCHOOLOS_V5_GROWTH_PRICE_APPROVAL: "V5_STAGING_GROWTH_99900_APPROVED",
  SCHOOLOS_V5_GROWTH_APPROVER_EMAIL: "finance-review@example.test",
  SCHOOLOS_V5_GROWTH_APPROVAL_REFERENCE: "FINANCE-APPROVAL-20261027",
});

const plan = Object.freeze({id: "growth-plan", code: "GROWTH", currency: "INR",
  taxRateBps: 1800, isActive: true, annualPricePaise: GROWTH_OLD_PAISE});

function fakeDb({p = plan, quotes = 0, invoices = 0, subscriptions = 0, updated = 1} = {}) {
  const calls = {transaction: 0, read: 0, writes: 0, audit: 0};
  const tx = {
    saaSPlan: {
      findUnique: async () => {calls.read++; return p;},
      updateMany: async () => {calls.writes++; return {count: updated};},
    },
    schoolOSQuotation: {count: async () => quotes},
    saaSInvoice: {count: async () => invoices},
    saaSSubscription: {count: async () => subscriptions},
    auditLog: {create: async () => {calls.audit++; return {id: "audit-1"};}},
  };
  return {calls, $transaction: async (fn, options) => {
    calls.transaction++;
    assert.equal(options.isolationLevel, "Serializable");
    return fn(tx);
  }};
}

test("fail closed before any DB call for production/other database, payment and video unsafe flags", async () => {
  const db = fakeDb();
  const targets = [
    {...env, WEB_URL: "https://beingbrilliantedu.com"},
    {...env, DATABASE_URL: "postgresql://schoolos_v5_user:x@prod/schoolos_v5_staging"},
    {...env, DATABASE_URL: "postgresql://schoolos_v5_user:x@postgres/production"},
    {...env, DATABASE_URL: "postgresql://other:x@postgres/schoolos_v5_staging"},
    {...env, DATABASE_URL: env.DATABASE_URL.replace("schema=public", "schema=other")},
    {...env, RAZORPAY_MODE: "live"},
    {...env, SCHOOLOS_VIDEO_ADMISSION_ENABLED: "true"},
    {...env, SCHOOLOS_VIDEO_SETTLEMENT_ENABLED: "true"},
    {...env, SCHOOLOS_VIDEO_ZERO_RELEASE_ENABLED: "true"},
    {...env, SCHOOLOS_VIDEO_WEBHOOK_ENABLED: "true"},
  ];
  for (const unsafe of targets) {
    assert.throws(() => assertV5GrowthStagingTarget(unsafe));
    await assert.rejects(reconcileV5GrowthStaging(db, {env: unsafe}));
  }
  assert.equal(db.calls.transaction, 0);
});

test("manual apply approval requires explicit exact token, approver and audit reference", async () => {
  for (const changes of [
    {SCHOOLOS_V5_GROWTH_PRICE_APPROVAL: ""},
    {SCHOOLOS_V5_GROWTH_APPROVER_EMAIL: ""},
    {SCHOOLOS_V5_GROWTH_APPROVAL_REFERENCE: ""},
  ]) {
    assert.throws(() => assertV5GrowthPriceApplyApproval({...env, ...changes}));
    const db = fakeDb();
    await assert.rejects(reconcileV5GrowthStaging(db, {apply: true, env: {...env, ...changes}}));
    assert.equal(db.calls.transaction, 0);
  }
});

test("default check only detects approved Growth price drift without writes", async () => {
  const db = fakeDb();
  const result = await reconcileV5GrowthStaging(db, {env});
  assert.equal(result.status, "CHANGE_SAFE_STAGING_ONLY");
  assert.equal(result.mode, "CHECK_ONLY");
  assert.equal(result.currentAnnualPaise, GROWTH_OLD_PAISE);
  assert.equal(result.approvedAnnualPaise, GROWTH_APPROVED_PAISE);
  assert.equal(result.commercialReleaseAuthorized, false);
  assert.equal(db.calls.writes, 0);
  assert.equal(db.calls.audit, 0);
});

test("no price rewrite when any existing quote, invoice or subscription references Growth", async () => {
  for (const key of ["quotes", "invoices", "subscriptions"]) {
    const db = fakeDb({[key]: 1});
    const checked = await reconcileV5GrowthStaging(db, {env});
    assert.equal(checked.status, "BLOCKED_EXISTING_COMMERCIAL_DEPENDENCIES");
    await assert.rejects(reconcileV5GrowthStaging(db, {env, apply: true}),
      /REFUSED_GROWTH_PRICE_UNSAFE/);
    assert.equal(db.calls.writes, 0);
    assert.equal(db.calls.audit, 0);
  }
});

test("unrecognized pricing or inactive/misconfigured plan is not normalized", async () => {
  for (const p of [
    {...plan, annualPricePaise: 8_999_000},
    {...plan, isActive: false},
    {...plan, taxRateBps: 0},
    null,
  ]) {
    const db = fakeDb({p});
    const result = await reconcileV5GrowthStaging(db, {env});
    assert.ok(result.status.startsWith("BLOCKED_"));
    assert.equal(db.calls.writes, 0);
  }
});

test("manual approved apply changes only Growth plan and creates one audit record", async () => {
  const db = fakeDb();
  const result = await reconcileV5GrowthStaging(db, {env, apply: true});
  assert.equal(result.status, "APPLIED_STAGING_ONLY");
  assert.equal(result.changed, true);
  assert.equal(result.commercialReleaseAuthorized, false);
  assert.equal(db.calls.writes, 1);
  assert.equal(db.calls.audit, 1);
});

test("compare-and-swap conflict aborts audit and reports no success", async () => {
  const db = fakeDb({updated: 0});
  await assert.rejects(reconcileV5GrowthStaging(db, {env, apply: true}),
    /REFUSED_GROWTH_PRICE_CONCURRENT_CHANGE/);
  assert.equal(db.calls.audit, 0);
});

test("already-aligned Growth is idempotent, without audit or mutation", async () => {
  const db = fakeDb({p: {...plan, annualPricePaise: GROWTH_APPROVED_PAISE}});
  const result = await reconcileV5GrowthStaging(db, {env, apply: true});
  assert.equal(result.status, "ALIGNED_NO_CHANGE");
  assert.equal(result.changed, false);
  assert.equal(db.calls.writes, 0);
  assert.equal(db.calls.audit, 0);
});

test("pure decision cannot equate a nonzero commercial dependency with safe change", () => {
  assert.equal(evaluateV5GrowthPrice({plan, quotes: 0, invoices: 0, subscriptions: 0}).status,
    "CHANGE_SAFE_STAGING_ONLY");
  assert.equal(evaluateV5GrowthPrice({plan, quotes: 0, invoices: 0, subscriptions: -1}).status,
    "BLOCKED_EXISTING_COMMERCIAL_DEPENDENCIES");
});
