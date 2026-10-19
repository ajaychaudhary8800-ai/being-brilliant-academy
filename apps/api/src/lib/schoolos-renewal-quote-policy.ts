import { AppError } from "./http.js";

export type SchoolOSRenewalSource = {
  id: string;
  organizationId: string;
  status: string;
  schoolOSQuoteId: string | null;
  periodEnd: Date;
  schoolOSPaymentRiskHold: { status: string } | null;
};
export type SchoolOSRenewalContext = {
  sourceInvoiceId: string;
  sourcePeriodEnd: string;
};
const obj = (x: unknown): Record<string, unknown> =>
  x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : {};

/** A renewal is a new independently priced and signed contract, never an extension of old grants. */
export function assertSchoolOSRenewalSource(
  source: SchoolOSRenewalSource | null,
  organizationId: string,
  latestPaidInvoiceId: string | null,
  expectedPeriodEnd?: string,
  proposedPeriodStart?: Date,
): SchoolOSRenewalContext {
  if (!source || source.organizationId !== organizationId)
    throw new AppError(404, "SCHOOLOS_RENEWAL_SOURCE_NOT_FOUND", "Previous paid SchoolOS contract not found for customer");
  if (source.status !== "PAID" || !source.schoolOSQuoteId || source.id !== latestPaidInvoiceId)
    throw new AppError(409, "SCHOOLOS_RENEWAL_SOURCE_NOT_LATEST_PAID", "Latest verified paid SchoolOS contract required");
  if (!Number.isFinite(source.periodEnd.getTime()))
    throw new AppError(409, "SCHOOLOS_RENEWAL_SOURCE_PERIOD_INVALID", "Previous paid term is invalid");
  if (source.schoolOSPaymentRiskHold?.status === "ACTIVE")
    throw new AppError(409, "SCHOOLOS_RENEWAL_FINANCE_REVIEW_REQUIRED", "Resolve previous payment risk before renewal");
  const periodEnd = source.periodEnd.toISOString();
  if (expectedPeriodEnd !== undefined && expectedPeriodEnd !== periodEnd)
    throw new AppError(409, "SCHOOLOS_RENEWAL_SOURCE_CHANGED", "Renewal contract no longer matches the original purchased term");
  if (proposedPeriodStart && proposedPeriodStart.getTime() < source.periodEnd.getTime())
    throw new AppError(409, "SCHOOLOS_RENEWAL_TERM_NOT_FINISHED", "A renewal cannot activate before the previous paid term ends");
  return { sourceInvoiceId: source.id, sourcePeriodEnd: periodEnd };
}

/** Reject malformed saved evidence; an absent renewal is a separate new sale. */
export function readSchoolOSRenewalContext(snapshot: unknown): SchoolOSRenewalContext | null {
  const record = obj(snapshot);
  if (!Object.prototype.hasOwnProperty.call(record, "renewal")) return null;
  const context = obj(record.renewal);
  if (typeof context.sourceInvoiceId !== "string" || context.sourceInvoiceId.length < 2 ||
      typeof context.sourcePeriodEnd !== "string" ||
      !Number.isFinite(new Date(context.sourcePeriodEnd).getTime()) ||
      new Date(context.sourcePeriodEnd).toISOString() !== context.sourcePeriodEnd)
    throw new AppError(409, "SCHOOLOS_RENEWAL_EVIDENCE_INVALID", "Signed renewal source evidence is incomplete");
  return { sourceInvoiceId: context.sourceInvoiceId, sourcePeriodEnd: context.sourcePeriodEnd };
}
