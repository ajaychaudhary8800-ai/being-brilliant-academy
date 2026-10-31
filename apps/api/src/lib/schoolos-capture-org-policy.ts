import { AppError } from "./http.js";

/** V5 signed quotation settlement must never override an administrative hold. */
export function assertSchoolOSCaptureOrganizationEligible(input: {
  invoiceOrganizationId: string;
  subscriptionOrganizationId: string;
  organizationStatus: string;
  subscriptionStatus: string;
  isActive: boolean;
  deletedAt: Date | null;
}): void {
  if (input.invoiceOrganizationId !== input.subscriptionOrganizationId)
    throw new AppError(409, "SCHOOLOS_CAPTURE_SUBSCRIPTION_TENANT_MISMATCH",
      "Captured invoice references a subscription owned by another institution");
  if (!input.isActive || input.deletedAt ||
    ["SUSPENDED", "CANCELLED"].includes(input.organizationStatus) ||
    ["SUSPENDED", "CANCELLED"].includes(input.subscriptionStatus))
    throw new AppError(409, "SCHOOLOS_CAPTURE_ORGANIZATION_SUSPENDED",
      "Administratively suspended customer cannot be reactivated by an old payment callback");
}
