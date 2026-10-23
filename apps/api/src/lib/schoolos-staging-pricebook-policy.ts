import { SCHOOL_OS_COMMERCIAL_REFERENCE } from "./schoolos-pricing-reconciliation.js";

export const FIXED_V5_PLANS = ["ESSENTIALS", "GROWTH", "PROFESSIONAL"] as const;
export type FixedV5Plan = typeof FIXED_V5_PLANS[number];

export type StagingPlanSnapshot = {
  id: string; code: string; annualPricePaise: number; currency: string;
  taxRateBps: number; isActive: boolean;
  existingQuotes: number; paidInvoices: number; outstandingInvoices: number;
};
export type PricebookAction = {
  planCode: FixedV5Plan; planId: string; previousPaise: number;
  proposedPaise: number; status: "ALIGNED" | "CHANGE_SAFE" | "BLOCKED";
  reasons: string[];
};

/** Pure, conservative staging-only planner. Never changes customer quotes/invoices. */
export function stagingPricebookPlan(plans: StagingPlanSnapshot[]): PricebookAction[] {
  return FIXED_V5_PLANS.map(planCode => {
    const found = plans.filter(plan => plan.code === planCode);
    const expected = SCHOOL_OS_COMMERCIAL_REFERENCE.tiers[planCode].annualPaise;
    const current = found[0];
    const reasons: string[] = [];
    if (found.length !== 1) reasons.push("The plan must exist exactly once");
    if (!current) return { planCode, planId: "", previousPaise: 0, proposedPaise: expected,
      status: "BLOCKED" as const, reasons };
    if (!current.isActive || current.currency !== "INR" || current.taxRateBps !== 1800)
      reasons.push("Plan is inactive or has non-approved currency/tax settings");
    if (!Number.isSafeInteger(current.annualPricePaise) || current.annualPricePaise <= 0)
      reasons.push("Configured plan annual price is invalid");
    // Commercial records prevent *repricing*, not read-only verification of an
    // already aligned tier. Staging has an existing Professional TEST invoice:
    // it must not veto unrelated, safe Essentials/Growth corrections.
    const needsRepricing = current.annualPricePaise !== expected;
    if (needsRepricing) {
      if (current.existingQuotes !== 0)
        reasons.push("Existing quotation snapshots (including DRAFT or REJECTED) may be submitted later; reconcile separately");
      if (current.paidInvoices !== 0)
        reasons.push("Historical PAID invoices require independent reconciliation");
      if (current.outstandingInvoices !== 0)
        reasons.push("Existing DRAFT, OPEN or OVERDUE invoices require independent reconciliation");
    }
    const status = reasons.length ? "BLOCKED" : needsRepricing ? "CHANGE_SAFE" : "ALIGNED";
    return { planCode, planId: current.id, previousPaise: current.annualPricePaise,
      proposedPaise: expected, status, reasons };
  });
}

/** Reject both production targets and untrusted automated CI/PR execution. */
export function assertV5StagingPricebookTarget(env: Record<string, string | undefined>, apply: boolean) {
  let db: URL;
  try { db = new URL(env.DATABASE_URL ?? ""); }
  catch { throw new Error("DATABASE_URL is missing or invalid"); }
  if (!["postgres:", "postgresql:"].includes(db.protocol) ||
      decodeURIComponent(db.pathname) !== "/schoolos_v5_staging" ||
      env.WEB_URL !== "https://v5-staging.beingbrilliantedu.com" ||
      env.RAZORPAY_MODE !== "test") {
    throw new Error("PRICEBOOK_TARGET_NOT_ISOLATED_V5_STAGING");
  }
  if (apply && (env.CI || env.GITHUB_ACTIONS ||
      env.SCHOOLOS_V5_STAGING_PRICEBOOK_APPLY !== "APPROVED-2026-10-18-V5-STAGING-ONLY"))
    throw new Error("PRICEBOOK_APPLY_NOT_AUTHORIZED");
}
