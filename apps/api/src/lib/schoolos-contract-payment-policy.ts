import { AppError } from "./http.js";
import { reconcileSchoolOSPricing } from "./schoolos-pricing-reconciliation.js";

type Plan = { id: string; code: string; annualPricePaise: number; taxRateBps: number; currency: string; isActive: boolean };
type Quote = {
  id: string; quoteNo: string; organizationId: string | null; status: string; billingCycle: string;
  planCode: string; validUntil: Date; totalPaise: number; subtotalPaise: number; taxPaise: number;
  discountBps: number; items: unknown; pricingSnapshot: unknown; contractDocumentId: string | null;
};
type Document = {
  id: string; documentType: string; documentReference: string; organizationId: string | null;
  verificationStatus: string; archivedAt: Date | null; signedAt: Date | null;
  verifiedAt: Date | null; uploadedById: string; verifiedById: string | null;
  lead: { wonOrganizationId: string | null };
};
const obj = (x: unknown): Record<string, unknown> =>
  x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : {};

export function validateSchoolOSBaseQuoteCheckout(
  quote: Quote, plan: Plan | null, document: Document | null, organizationId: string,
  now = new Date(), existingOrder = false,
): { baseAmountPaise: number; taxPaise: number; totalPaise: number } {
  if (quote.organizationId !== organizationId)
    throw new AppError(403, "SCHOOLOS_QUOTE_TENANT_MISMATCH", "This quotation belongs to another organization");
  if (quote.status !== "CONTRACTED" && !(existingOrder && quote.status === "PAYMENT_PENDING"))
    throw new AppError(409, "SCHOOLOS_QUOTE_NOT_CONTRACTED", "A signed accepted quotation is required");
  if (!existingOrder && quote.validUntil.getTime() <= now.getTime())
    throw new AppError(409, "SCHOOLOS_QUOTE_EXPIRED", "Quotation has expired");
  if (!plan || !plan.isActive || plan.code !== quote.planCode || plan.currency !== "INR" || quote.billingCycle !== "ANNUAL")
    throw new AppError(409, "SCHOOLOS_PLAN_UNAVAILABLE", "Quote cannot be settled against the current annual INR plan");
  if (reconcileSchoolOSPricing(plan.code, plan).status !== "ALIGNED")
    throw new AppError(409, "SCHOOLOS_PRICING_REVIEW_REQUIRED", "Approved commercial rates must be reconciled first");

  if (!quote.contractDocumentId || !document || document.id !== quote.contractDocumentId
    || document.documentType !== "SIGNED_ORDER_FORM" || document.documentReference !== quote.quoteNo
    || document.archivedAt !== null || document.verificationStatus !== "VERIFIED"
    || !document.signedAt || !document.verifiedAt || !document.verifiedById
    || document.uploadedById === document.verifiedById
    || document.lead.wonOrganizationId !== organizationId
    || (document.organizationId !== null && document.organizationId !== organizationId))
    throw new AppError(409, "SCHOOLOS_CONTRACT_EVIDENCE_INVALID", "Verified matching signed order evidence is required");

  // Add-ons, discount, pilots and custom enterprise prices require a separate licensed metering and
  // payment split implementation. Do not silently activate unlicensed services.
  if (!Array.isArray(quote.items) || quote.items.length !== 0 || quote.discountBps !== 0)
    throw new AppError(409, "SCHOOLOS_CUSTOM_QUOTE_CHECKOUT_UNSUPPORTED", "Only undiscounted base-plan quotes support automated settlement");

  const snap = obj(quote.pricingSnapshot);
  const rate = obj(snap.rateCardSnapshot);
  const amount = plan.annualPricePaise;
  const tax = Math.round(amount * plan.taxRateBps / 10_000);
  if (amount <= 0 || !Number.isSafeInteger(amount) || !Number.isSafeInteger(tax)
    || amount + tax > 2_147_483_647)
    throw new AppError(409, "SCHOOLOS_QUOTE_AMOUNT_INVALID", "Base quote amount is not valid");
  if (rate.planId !== plan.id || rate.planCode !== plan.code || rate.currency !== "INR"
    || rate.billingCycle !== "ANNUAL" || rate.basePricePaise !== amount || rate.taxRateBps !== plan.taxRateBps
    || obj(snap.pricing).totalPaise !== quote.totalPaise || quote.subtotalPaise !== amount
    || quote.taxPaise !== tax || quote.totalPaise !== amount + tax)
    throw new AppError(409, "SCHOOLOS_QUOTE_PRICE_CHANGED", "Quote does not match the immutable approved annual base plan price");
  return { baseAmountPaise: amount, taxPaise: tax, totalPaise: amount + tax };
}
