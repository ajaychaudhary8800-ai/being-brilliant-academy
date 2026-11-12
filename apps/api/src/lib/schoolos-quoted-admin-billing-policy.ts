import { OrganizationSubscriptionStatus } from "@prisma/client";
import { AppError } from "./http.js";

/**
 * V5 only. Once a tenant has a signed-quotation checkout invoice, even an
 * authorized platform admin must not replace payment controls with an
 * unlimited legacy trial or switch off commercial feature enforcement.
 * V4 legacy institutions without quotation invoices retain their behavior.
 */
export function assertSchoolOSQuotedBillingAdminGuard(
  hasQuoteBackedInvoice: boolean,
  proposedStatus: OrganizationSubscriptionStatus,
  effectiveEnforcementEnabled: boolean,
): void {
  if (!hasQuoteBackedInvoice) return;
  if (proposedStatus === OrganizationSubscriptionStatus.TRIAL)
    throw new AppError(409, "SCHOOLOS_SIGNED_QUOTE_TRIAL_BYPASS_DENIED",
      "A contracted SchoolOS tenant cannot revert to an unlimited legacy trial");
  if (!effectiveEnforcementEnabled)
    throw new AppError(409, "SCHOOLOS_SIGNED_QUOTE_ENFORCEMENT_REQUIRED",
      "Commercial feature enforcement must remain enabled for contracted SchoolOS");
}
