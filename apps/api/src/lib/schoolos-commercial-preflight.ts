import { reconcileSchoolOSPricing, SCHOOL_OS_COMMERCIAL_REFERENCE, schoolOSPriceBookReconciled } from "./schoolos-pricing-reconciliation.js";
import { FIXED_V5_PLANS, stagingPricebookPlan, type StagingPlanSnapshot } from "./schoolos-staging-pricebook-policy.js";

type CatalogPlan = Pick<StagingPlanSnapshot, "id"|"code"|"annualPricePaise"|"currency"|"taxRateBps"|"isActive">;
type Config = Record<string, string | undefined>;

const configured = (value: string | undefined) => typeof value === "string" && value.trim().length > 0;

/**
 * Read-only technical snapshot for a HUMAN commercial GO/NO-GO review.
 * No data mutation, tenant identity, secret, key prefix, user, email address,
 * invoice ID, signed contract or provider balance is included in this result.
 *
 * A healthy config is NOT a successful provider acceptance test or permission
 * to collect a payment. The immutable, independently signed 10-gate V5
 * release manifest remains the sole production release authority.
 */
export function assessSchoolOSCommercialPreflight(
  plans: CatalogPlan[],
  fixedPlanHistory: StagingPlanSnapshot[],
  environment: Config,
) {
  const actions = stagingPricebookPlan(fixedPlanHistory);
  const evaluations = ["ESSENTIALS", "GROWTH", "PROFESSIONAL", "ENTERPRISE"].map(code => {
    const matches = plans.filter(plan => plan.code === code);
    const evaluation = reconcileSchoolOSPricing(code, matches.length === 1 ? matches[0]! : null);
    return {
      planCode: code,
      status: matches.length > 1 ? "RECONCILIATION_REQUIRED" as const : evaluation.status,
      issues: matches.length > 1 ? ["Duplicate configured tier; finance reconciliation required"] : evaluation.issues,
    };
  });
  const priceBookAligned = schoolOSPriceBookReconciled(evaluations);
  const providerChecks = {
    razorpayTestCredentialsPresent: environment.RAZORPAY_MODE === "test" &&
      (environment.RAZORPAY_KEY_ID ?? "").startsWith("rzp_test_") &&
      configured(environment.RAZORPAY_KEY_SECRET) && configured(environment.RAZORPAY_WEBHOOK_SECRET),
    smtpCredentialsPresent: ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"]
      .every(key => configured(environment[key])),
    liveKitCredentialsPresent: ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]
      .every(key => configured(environment[key])),
    videoPaidAdmissionEnabled: environment.SCHOOLOS_VIDEO_ADMISSION_ENABLED === "true" &&
      configured(environment.SCHOOLOS_VIDEO_ADMISSION_TENANT_IDS),
    videoSettlementEnabled: environment.SCHOOLOS_VIDEO_SETTLEMENT_ENABLED === "true" &&
      configured(environment.SCHOOLOS_VIDEO_SETTLEMENT_TENANT_IDS),
  };
  const launchBlockers: string[] = [];
  if (!priceBookAligned) launchBlockers.push("CATALOGUE_FINANCE_RECONCILIATION");
  if (!providerChecks.razorpayTestCredentialsPresent) launchBlockers.push("RAZORPAY_TEST_CONFIGURATION_INCOMPLETE");
  if (!providerChecks.smtpCredentialsPresent) launchBlockers.push("SMTP_CONFIGURATION_INCOMPLETE");
  if (!providerChecks.liveKitCredentialsPresent) launchBlockers.push("LIVEKIT_CONFIGURATION_INCOMPLETE");
  // These are intentionally *never* inferred from secrets or data snapshots.
  launchBlockers.push("REAL_PROVIDER_ACCEPTANCE_AND_SIGNED_CUSTOMER_UAT_NOT_VERIFIED");
  launchBlockers.push("INDEPENDENT_RELEASE_GATES_AND_OWNER_APPROVAL_REQUIRED");

  return {
    product: "Adhyay SchoolOS", version: "5.0",
    mode: "STAGING_READ_ONLY_NO_PAYMENT_NO_WRITES",
    approvedReference: SCHOOL_OS_COMMERCIAL_REFERENCE.referenceId,
    priceBookAligned,
    fixedPriceActions: actions.map(action => ({
      tier: action.planCode, currentAnnualPaise: action.previousPaise,
      approvedAnnualPaise: action.proposedPaise,
      status: action.status, reviewReasons: action.reasons,
      historicalQuotes: fixedPlanHistory.find(plan => plan.code === action.planCode)?.existingQuotes ?? null,
      paidInvoices: fixedPlanHistory.find(plan => plan.code === action.planCode)?.paidInvoices ?? null,
      outstandingInvoices: fixedPlanHistory.find(plan => plan.code === action.planCode)?.outstandingInvoices ?? null,
    })),
    enterprisePricing: evaluations.find(entry => entry.planCode === "ENTERPRISE"),
    providerChecks, launchBlockers,
    // No staging dry run is a replacement for provider, legal, customer or owner proof.
    providerConnectivityTested: false,
    actualPaymentsCreated: false,
    customerRecordsModified: false,
    commercialReleaseVerified: false,
    paidLaunchAuthorized: false,
    nextAction: "Finance review the staging pricebook and perform authenticated real-provider TEST, signed-contract, DR, UAT and independent 10-gate owner acceptance.",
  };
}
