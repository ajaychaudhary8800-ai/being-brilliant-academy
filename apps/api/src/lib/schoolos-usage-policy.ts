/** Strict metered add-on catalogue. No admin or customer minting endpoints. */
export const schoolOSUsageMetrics = [
  { key: "ai_credits", label: "AI credits", quoteCategory: "AI_USAGE", service: "AI" },
  { key: "video_minutes", label: "Video minutes", quoteCategory: "VIDEO_USAGE", service: "VIDEO" },
] as const;
export type SchoolOSUsageMetric = (typeof schoolOSUsageMetrics)[number]["key"];
export function isSchoolOSUsageMetric(value: string): value is SchoolOSUsageMetric {
  return schoolOSUsageMetrics.some(item => item.key === value);
}

type Invoice = { id: string; organizationId: string; status: string; currency: string; totalPaise: number; schoolOSQuoteId: string | null; paidAt: Date | null };
type Quote = { id: string; organizationId: string | null; status: string; totalPaise: number; items: unknown; pricingSnapshot: unknown };
type Payment = { status: string; invoiceId: string; amountPaise: number; currency: string; providerPaymentId: string | null };

export function paidQuoteAddonGrantItems(invoice: Invoice, quote: Quote | null, payment: Payment | null): Array<{ metric: SchoolOSUsageMetric; units: number }> {
  if (invoice.status !== "PAID" || invoice.currency !== "INR" || !invoice.schoolOSQuoteId || !invoice.paidAt ||
    !quote || quote.id !== invoice.schoolOSQuoteId || quote.organizationId !== invoice.organizationId ||
    quote.status !== "PAID" || quote.totalPaise !== invoice.totalPaise ||
    !payment || payment.status !== "CAPTURED" || payment.invoiceId !== invoice.id) {
    throw new Error("SCHOOLOS_PAID_QUOTE_EVIDENCE_REQUIRED");
  }
  if (!payment.providerPaymentId || payment.amountPaise !== invoice.totalPaise || payment.currency !== "INR")
    throw new Error("SCHOOLOS_PAID_QUOTE_PAYMENT_MISMATCH");
  if (!Array.isArray(quote.items)) throw new Error("SCHOOLOS_QUOTE_ITEMS_INVALID");
  const snapshot = quote.pricingSnapshot && typeof quote.pricingSnapshot === "object" && !Array.isArray(quote.pricingSnapshot)
    ? quote.pricingSnapshot as Record<string, unknown> : {};
  const pricing = snapshot.pricing && typeof snapshot.pricing === "object" && !Array.isArray(snapshot.pricing)
    ? snapshot.pricing as Record<string, unknown> : {};
  if (pricing.totalPaise !== invoice.totalPaise) throw new Error("SCHOOLOS_QUOTE_SNAPSHOT_MISMATCH");
  const grants: Array<{ metric: SchoolOSUsageMetric; units: number }> = [];
  const used = new Set<string>();
  for (const raw of quote.items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("SCHOOLOS_QUOTE_ITEM_INVALID");
    const item = raw as Record<string, unknown>;
    if (item.category !== "AI_USAGE" && item.category !== "VIDEO_USAGE") continue;
    const code = String(item.code ?? "");
    const valid = schoolOSUsageMetrics.find(metric => metric.key === code && metric.quoteCategory === item.category);
    if (!valid || used.has(code) || typeof item.quantity !== "number" || !Number.isSafeInteger(item.quantity) ||
      item.quantity <= 0 || item.quantity > 100_000 ||
      typeof item.unitPricePaise !== "number" || !Number.isSafeInteger(item.unitPricePaise) || item.unitPricePaise <= 0) {
      throw new Error("SCHOOLOS_QUOTE_USAGE_ITEM_UNSUPPORTED");
    }
    used.add(code);
    grants.push({ metric: valid.key, units: Number(item.quantity) });
  }
  return grants;
}

export function assertSchoolOSUsageRequest(input: { metric: string; units: number; requestKey: string }) {
  if (!isSchoolOSUsageMetric(input.metric)) throw new Error("SCHOOLOS_USAGE_METRIC_INVALID");
  if (!Number.isSafeInteger(input.units) || input.units <= 0 || input.units > 100_000)
    throw new Error("SCHOOLOS_USAGE_UNITS_INVALID");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:_-]{7,119}$/.test(input.requestKey))
    throw new Error("SCHOOLOS_USAGE_IDEMPOTENCY_INVALID");
  return { ...input, metric: input.metric as SchoolOSUsageMetric };
}
