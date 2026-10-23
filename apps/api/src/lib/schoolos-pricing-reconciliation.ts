/**
 * SchoolOS 5.0 commercial reference — compare, do NOT mutate production plans.
 * Finance must approve activation of a reconciled price book before external issuance.
 */
export const SCHOOL_OS_COMMERCIAL_REFERENCE = {
  referenceId: "SCHOOLOS-LAUNCH-2027-INDIA-V1",
  approvedAt: "2026-10-18",
  currency: "INR",
  expectedTaxRateBps: 1800,
  pilot: { days: 60, amountPaise: 1_499_900 },
  tiers: {
    ESSENTIALS: { annualPaise: 4_990_000, onboardingEstimatePaise: 999_900 },
    GROWTH: { annualPaise: 9_990_000, onboardingEstimatePaise: 1_499_900 },
    PROFESSIONAL: { annualPaise: 14_999_000, onboardingEstimatePaise: 2_499_900 },
    ENTERPRISE: { annualPaise: null, onboardingEstimatePaise: null },
  },
} as const;
export type SchoolOSPricingStatus = "ALIGNED" | "RECONCILIATION_REQUIRED" | "CUSTOM_QUOTE_REQUIRED" | "PLAN_NOT_FOUND" | "UNKNOWN_TIER";

type PlanPrice = {
  code: string; currency: string; annualPricePaise: number; taxRateBps: number; isActive: boolean;
};
const tiers: Record<string, { annualPaise: number | null; onboardingEstimatePaise: number | null }> =
  SCHOOL_OS_COMMERCIAL_REFERENCE.tiers;

export function reconcileSchoolOSPricing(planCode: string, plan: PlanPrice | null) {
  const standard = tiers[planCode];
  if (!standard) return { status: "UNKNOWN_TIER" as SchoolOSPricingStatus, planCode, referenceId: SCHOOL_OS_COMMERCIAL_REFERENCE.referenceId, issues: ["No approved rate exists for this tier"] };
  if (!plan) return { status: "PLAN_NOT_FOUND" as SchoolOSPricingStatus, planCode, referenceId: SCHOOL_OS_COMMERCIAL_REFERENCE.referenceId, issues: ["Plan not found in SaaS catalogue"] };
  const issues: string[] = [];
  if (!plan.isActive) issues.push("Plan is inactive");
  if (plan.currency !== SCHOOL_OS_COMMERCIAL_REFERENCE.currency) issues.push("Currency must be INR");
  if (plan.taxRateBps !== SCHOOL_OS_COMMERCIAL_REFERENCE.expectedTaxRateBps) issues.push("Check the configured GST rate against the approved India reference");
  if (standard.annualPaise === null) {
    issues.push("Enterprise requires a manually authorised custom commercial quotation");
    return {
      status: "CUSTOM_QUOTE_REQUIRED" as SchoolOSPricingStatus,
      planCode,
      referenceId: SCHOOL_OS_COMMERCIAL_REFERENCE.referenceId,
      configuredAnnualPaise: plan.annualPricePaise,
      expectedAnnualPaise: null, issues,
    };
  }
  if (plan.annualPricePaise !== standard.annualPaise)
    issues.push(`Annual price differs from launch reference by ${plan.annualPricePaise - standard.annualPaise} paise`);
  return {
    status: (issues.length ? "RECONCILIATION_REQUIRED" : "ALIGNED") as SchoolOSPricingStatus,
    planCode,
    referenceId: SCHOOL_OS_COMMERCIAL_REFERENCE.referenceId,
    configuredAnnualPaise: plan.annualPricePaise,
    expectedAnnualPaise: standard.annualPaise,
    onboardingEstimatePaise: standard.onboardingEstimatePaise,
    issues,
  };
}

export function schoolOSExternalQuoteReady(params: {
  quoteStatus: string; validUntil: Date; planResult: ReturnType<typeof reconcileSchoolOSPricing>;
  clientOrganizationId: string | null; today?: Date;
}) {
  const reasons: string[] = [];
  if (params.quoteStatus !== "INTERNALLY_APPROVED") reasons.push("Maker-checker approval not complete");
  if (params.validUntil.getTime() <= (params.today ?? new Date()).getTime()) reasons.push("Quotation expired");
  if (!params.clientOrganizationId) reasons.push("Customer tenant not linked");
  if (params.planResult.status !== "ALIGNED") reasons.push("Rate book and production plan are not reconciled");
  // A future legally vetted order acceptance and payment capture remain independent requirements.
  return { commercialReviewReady: reasons.length === 0, activationAllowed: false, reasons };
}

/**
 * Only the three fixed-price tiers must match the approved rate card.
 * ENTERPRISE is intentionally custom-priced; it can never have ALIGNED status.
 * Misconfigured/inactive Enterprise still prevents a fully reconciled catalogue.
 * This flag is informational and does NOT authorize external issuance or checkout.
 */
export function schoolOSPriceBookReconciled(
  evaluations: Array<{ planCode: string; status: SchoolOSPricingStatus; issues: string[] }>,
) {
  const byPlan = new Map(evaluations.map(item => [item.planCode, item]));
  return ["ESSENTIALS", "GROWTH", "PROFESSIONAL"].every(
    code => byPlan.get(code)?.status === "ALIGNED",
  ) && byPlan.get("ENTERPRISE")?.status === "CUSTOM_QUOTE_REQUIRED"
    && byPlan.get("ENTERPRISE")?.issues.length === 1;
}
