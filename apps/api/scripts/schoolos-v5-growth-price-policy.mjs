/**
 * V5-only staging price correction policy. NEVER run against V4/production.
 * Finance reference: approved 18 October 2026, GROWTH INR 99,900/year.
 * The specific candidate drift measured in V5 staging was INR 99,990/year.
 */
export const GROWTH_OLD_PAISE = 9_999_000;
export const GROWTH_APPROVED_PAISE = 9_990_000;
export const GROWTH_PRICE_APPROVAL = "V5_STAGING_GROWTH_99900_APPROVED";

export function assertV5GrowthStagingTarget(env) {
  if (env.WEB_URL !== "https://v5-staging.beingbrilliantedu.com"
    || env.RAZORPAY_MODE !== "test"
    || ["SCHOOLOS_VIDEO_ADMISSION_ENABLED", "SCHOOLOS_VIDEO_SETTLEMENT_ENABLED",
        "SCHOOLOS_VIDEO_ZERO_RELEASE_ENABLED", "SCHOOLOS_VIDEO_WEBHOOK_ENABLED"]
       .some(key => /^(true|1|yes|on)$/i.test(String(env[key] ?? "").trim())))
    throw new Error("REFUSED_NON_ISOLATED_V5_STAGING_OR_UNSAFE_BILLING_FLAGS");
  let database;
  try { database = new URL(env.DATABASE_URL); }
  catch { throw new Error("REFUSED_INVALID_V5_DATABASE_TARGET"); }
  if (!["postgres:", "postgresql:"].includes(database.protocol)
    || database.hostname !== "postgres"
    || database.pathname !== "/schoolos_v5_staging"
    || database.username !== "schoolos_v5_user"
    || (database.port && database.port !== "5432")
    || database.hash
    || [...database.searchParams.keys()].some(key => key !== "schema")
    || (database.searchParams.has("schema") && database.searchParams.get("schema") !== "public"))
    throw new Error("REFUSED_NON_ISOLATED_V5_DATABASE_TARGET");
  return true;
}

/** Read-only policy decision; no mutation, provider call or quotation issuance. */
export function evaluateV5GrowthPrice({plan, quotes, invoices, subscriptions}) {
  if (!plan || plan.code !== "GROWTH" || plan.currency !== "INR"
    || plan.taxRateBps !== 1800 || plan.isActive !== true)
    return {status: "BLOCKED_PLAN_CONFIGURATION"};
  if (plan.annualPricePaise === GROWTH_APPROVED_PAISE)
    return {status: "ALIGNED_NO_CHANGE"};
  if (plan.annualPricePaise !== GROWTH_OLD_PAISE)
    return {status: "BLOCKED_UNRECOGNIZED_PRICE"};
  if (![quotes, invoices, subscriptions].every(value => Number.isSafeInteger(value) && value === 0))
    return {status: "BLOCKED_EXISTING_COMMERCIAL_DEPENDENCIES"};
  return {status: "CHANGE_SAFE_STAGING_ONLY"};
}

export function assertV5GrowthPriceApplyApproval(env) {
  if (env.SCHOOLOS_V5_GROWTH_PRICE_APPROVAL !== GROWTH_PRICE_APPROVAL)
    throw new Error("REFUSED_EXPLICIT_PRICE_APPROVAL_MISSING");
  if (typeof env.SCHOOLOS_V5_GROWTH_APPROVER_EMAIL !== "string"
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.SCHOOLOS_V5_GROWTH_APPROVER_EMAIL))
    throw new Error("REFUSED_APPROVER_EMAIL_MISSING");
  if (typeof env.SCHOOLOS_V5_GROWTH_APPROVAL_REFERENCE !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{7,119}$/.test(env.SCHOOLOS_V5_GROWTH_APPROVAL_REFERENCE))
    throw new Error("REFUSED_AUDIT_REFERENCE_MISSING");
  return true;
}
