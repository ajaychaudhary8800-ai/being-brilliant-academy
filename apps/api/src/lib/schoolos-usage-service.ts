import { Prisma, SaaSInvoiceStatus, SaaSPaymentStatus } from "@prisma/client";
import { AppError } from "./http.js";
import { systemPrisma } from "./prisma.js";
import { assertSchoolOSUsageRequest, isSchoolOSUsageMetric, paidQuoteAddonGrantItems, type SchoolOSUsageMetric } from "./schoolos-usage-policy.js";

const MAX_UNITS = 2_147_483_647;

/** Service-only: there is intentionally NO REST endpoint to mint or spend metered credits. */
export async function grantSchoolOSPaidQuoteCredits(invoiceId: string) {
  return systemPrisma.$transaction(async tx => {
    const invoice = await tx.saaSInvoice.findUnique({
      where: { id: invoiceId },
      include: {
        schoolOSQuote: true,
        payments: { where: { status: SaaSPaymentStatus.CAPTURED } },
      },
    });
    if (!invoice || !invoice.schoolOSQuote || invoice.status !== SaaSInvoiceStatus.PAID)
      throw new AppError(409, "SCHOOLOS_ADDON_NOT_PAID", "Verified paid invoice and signed quotation required");

    const quote = invoice.schoolOSQuote;
    const matchingPayments = invoice.payments.filter(p =>
      p.providerPaymentId && p.amountPaise === invoice.totalPaise && p.currency === invoice.currency
    );
    if (matchingPayments.length !== 1 || !invoice.providerOrderId)
      throw new AppError(409, "SCHOOLOS_ADDON_PAYMENT_UNVERIFIED", "Matching captured provider payment required");
    if (!quote.contractDocumentId || !quote.organizationId || quote.organizationId !== invoice.organizationId)
      throw new AppError(409, "SCHOOLOS_ADDON_SIGNED_CONTRACT_REQUIRED", "Matching signed quotation required");
    const doc = await tx.saaSCommercialDocument.findUnique({
      where: { id: quote.contractDocumentId },
      include: { lead: { select: { wonOrganizationId: true } } },
    });
    if (!doc || doc.archivedAt || !doc.signedAt || doc.verificationStatus !== "VERIFIED"
      || doc.documentReference !== quote.quoteNo || doc.lead.wonOrganizationId !== invoice.organizationId)
      throw new AppError(409, "SCHOOLOS_ADDON_SIGNED_CONTRACT_INVALID", "Signed agreement is missing or unverified");

    let grants: ReturnType<typeof paidQuoteAddonGrantItems>;
    try {
      grants = paidQuoteAddonGrantItems(invoice, quote, matchingPayments[0]!);
    } catch {
      throw new AppError(409, "SCHOOLOS_ADDON_QUOTE_MISMATCH", "Quoted add-on payment evidence failed strict checks");
    }
    if (!grants.length) return { credited: [], alreadyCredited: [] };

    const credited: string[] = [];
    const alreadyCredited: string[] = [];
    for (const grant of grants) {
      // Tenant+metric lock serializes any debit, grant, or overlapping credit period.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"schoolos-usage:" + invoice.organizationId + ":" + grant.metric}))`;
      const requestKey = `paid-invoice:${invoice.id}:${grant.metric}`;
      const existing = await tx.schoolOSUsageEvent.findUnique({
        where: { organizationId_metric_requestKey: { organizationId: invoice.organizationId, metric: grant.metric, requestKey } },
      });
      if (existing) {
        if (existing.kind !== "GRANT" || existing.units !== grant.units || existing.sourceInvoiceId !== invoice.id)
          throw new AppError(409, "SCHOOLOS_ADDON_GRANT_REPLAY_CONFLICT", "Paid credit replay parameters differ");
        alreadyCredited.push(grant.metric);
        continue;
      }
      const matching = await tx.schoolOSUsageBalance.findMany({
        where: { organizationId: invoice.organizationId, metric: grant.metric,
          periodStart: { lt: invoice.periodEnd }, periodEnd: { gt: invoice.periodStart } },
      });
      if (matching.some(p => p.periodStart.getTime() !== invoice.periodStart.getTime() || p.periodEnd.getTime() !== invoice.periodEnd.getTime()))
        throw new AppError(409, "SCHOOLOS_ADDON_CREDIT_PERIOD_CONFLICT", "Overlapping metered billing periods require reconciliation");
      let bucket = matching[0];
      if (!bucket) {
        bucket = await tx.schoolOSUsageBalance.create({
          data: { organizationId: invoice.organizationId, metric: grant.metric,
            periodStart: invoice.periodStart, periodEnd: invoice.periodEnd, grantedUnits: 0, consumedUnits: 0 },
        });
      }
      const updated = await tx.schoolOSUsageBalance.updateMany({
        where: { id: bucket.id, grantedUnits: { lte: MAX_UNITS - grant.units } },
        data: { grantedUnits: { increment: grant.units } },
      });
      if (updated.count !== 1) throw new AppError(409, "SCHOOLOS_ADDON_GRANT_OVERFLOW", "Grant would exceed safe metered quota");
      await tx.schoolOSUsageEvent.create({
        data: { organizationId: invoice.organizationId, balanceId: bucket.id,
          metric: grant.metric, kind: "GRANT", units: grant.units,
          requestKey, sourceInvoiceId: invoice.id, actorId: "VERIFIED_PAYMENT" },
      });
      credited.push(grant.metric);
    }
    return { credited, alreadyCredited };
  });
}

/**
 * Service-only for authenticated AI/LiveKit workers. Call with a stable, service-generated
 * idempotency key before a billable operation, and handle failed execution/reversal separately.
 * Not yet wired into existing runtime providers.
 */
export async function consumeSchoolOSUsage(
  organizationId: string, metric: SchoolOSUsageMetric, units: number, requestKey: string, actorId: string | null = null,
  now = new Date(),
) {
  const value = assertSchoolOSUsageRequest({ metric, units, requestKey });
  if (!organizationId || organizationId === "org_default")
    throw new AppError(403, "SCHOOLOS_USAGE_TENANT_REQUIRED", "Metered credits require a customer tenant");

  return systemPrisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"schoolos-usage:" + organizationId + ":" + value.metric}))`;
    const prior = await tx.schoolOSUsageEvent.findUnique({
      where: { organizationId_metric_requestKey: { organizationId, metric: value.metric, requestKey } },
    });
    if (prior) {
      if (prior.kind !== "CONSUME" || prior.units !== value.units)
        throw new AppError(409, "SCHOOLOS_USAGE_REPLAY_CONFLICT", "Request key already used with different units or event kind");
      const current = await tx.schoolOSUsageBalance.findUnique({ where: { id: prior.balanceId } });
      return { charged: false, balanceId: prior.balanceId, remainingUnits: (current?.grantedUnits ?? 0) - (current?.consumedUnits ?? 0) };
    }

    const buckets = await tx.schoolOSUsageBalance.findMany({
      where: { organizationId, metric: value.metric, periodStart: { lte: now }, periodEnd: { gt: now } },
    });
    if (buckets.length !== 1)
      throw new AppError(409, "SCHOOLOS_USAGE_PERIOD_UNAVAILABLE", "A single active paid usage period is required");
    const bucket = buckets[0]!;
    const updated = await tx.schoolOSUsageBalance.updateMany({
      where: { id: bucket.id, consumedUnits: { lte: bucket.grantedUnits - value.units } },
      data: { consumedUnits: { increment: value.units } },
    });
    if (updated.count !== 1)
      throw new AppError(402, "SCHOOLOS_USAGE_BALANCE_EXHAUSTED", "Insufficient prepaid usage credits");

    await tx.schoolOSUsageEvent.create({
      data: { organizationId, balanceId: bucket.id, metric: value.metric, kind: "CONSUME",
        units: value.units, requestKey, actorId },
    });
    return { charged: true, balanceId: bucket.id, remainingUnits: bucket.grantedUnits - bucket.consumedUnits - value.units };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function schoolOSUsageReport(organizationId: string) {
  if (!organizationId || organizationId === "org_default")
    throw new AppError(403, "SCHOOLOS_USAGE_TENANT_REQUIRED", "Customer tenant required");
  const [balances, events] = await Promise.all([
    systemPrisma.schoolOSUsageBalance.findMany({
      where: { organizationId }, orderBy: [{ periodEnd: "desc" }, { metric: "asc" }], take: 40,
      select: { id: true, metric: true, periodStart: true, periodEnd: true, grantedUnits: true, consumedUnits: true },
    }),
    systemPrisma.schoolOSUsageEvent.findMany({
      where: { organizationId }, orderBy: { createdAt: "desc" }, take: 50,
      select: { metric: true, kind: true, units: true, createdAt: true },
    }),
  ]);
  return {
    balances: balances.map(b => ({ ...b, remainingUnits: b.grantedUnits - b.consumedUnits })),
    events,
    activationStatus: "FOUNDATION_ONLY",
    meteringConnected: false,
  };
}
