import { AppError } from "./http.js";
import { calculateSchoolOSQuote, type SchoolOSQuoteItem } from "./schoolos-quotation.js";
import { reconcileSchoolOSPricing } from "./schoolos-pricing-reconciliation.js";
import type { SchoolOSAddonRate } from "./schoolos-addon-pricing-policy.js";

const rec = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const moduleCodes = new Set(["lms","crm","examinations","communication","hr_payroll","finance","library","inventory","analytics","transport","hostel","multi_branch","white_label","custom_domain"]);
const capacityCodes = new Set(["students","users","branches"]);
type Plan = { id: string; code: string; annualPricePaise: number; taxRateBps: number; currency: string; isActive: boolean };
type Quote = { id: string; quoteNo: string; organizationId: string | null; status: string; billingCycle: string; planCode: string; validUntil: Date; createdAt: Date; totalPaise: number; subtotalPaise: number; taxPaise: number; discountBps: number; discountPaise: number; items: unknown; pricingSnapshot: unknown; contractDocumentId: string | null };
type Document = { id: string; documentType: string; documentReference: string; organizationId: string | null; verificationStatus: string; archivedAt: Date | null; signedAt: Date | null; verifiedAt: Date | null; uploadedById: string; verifiedById: string | null; lead: { wonOrganizationId: string | null } };
export type SchoolOSApprovedAddonLine = SchoolOSQuoteItem & { rateId: string; rateRevision: number };

export function validateSchoolOSAddonCheckout(
 quote: Quote, plan: Plan | null, document: Document | null, organizationId: string,
 rates: SchoolOSAddonRate[], now = new Date(), existingOrder = false,
) {
 const deny = (code: string, message: string): never => { throw new AppError(409, code, message); };
 if (quote.organizationId !== organizationId) deny("SCHOOLOS_ADDON_TENANT_MISMATCH", "Quote belongs to another tenant");
 if (quote.status !== "CONTRACTED" && !(existingOrder && quote.status === "PAYMENT_PENDING")) deny("SCHOOLOS_ADDON_NOT_CONTRACTED", "Signed quote required");
 if (!existingOrder && quote.validUntil.getTime() <= now.getTime()) deny("SCHOOLOS_ADDON_QUOTE_EXPIRED", "Signed quote expired");
 if (!plan || !plan.isActive || plan.code !== quote.planCode || plan.currency !== "INR"
     || quote.billingCycle !== "ANNUAL" || reconcileSchoolOSPricing(plan.code,plan).status !== "ALIGNED")
   deny("SCHOOLOS_ADDON_BASE_PLAN_REVIEW_REQUIRED", "Base-plan commercial price not reconciled");
 if (!document || !quote.contractDocumentId || document.id !== quote.contractDocumentId
     || document.documentType !== "SIGNED_ORDER_FORM" || document.documentReference !== quote.quoteNo
     || document.verificationStatus !== "VERIFIED" || document.archivedAt
     || !document.signedAt || !document.verifiedAt || !document.verifiedById
     || document.verifiedById === document.uploadedById
     || document.lead.wonOrganizationId !== organizationId
     || (document.organizationId && document.organizationId !== organizationId))
   deny("SCHOOLOS_ADDON_CONTRACT_INVALID", "Independently verified same-tenant signed order required");
 if (quote.discountBps !== 0 || quote.discountPaise !== 0 || !Array.isArray(quote.items)
     || !quote.items.length || quote.items.length > 60)
   deny("SCHOOLOS_ADDON_UNSUPPORTED_LINES", "Only undiscounted catalogue add-ons are payable");

 const validatedPlan = plan!;
 const quoteItems = quote.items as unknown[];
 const snapshot=rec(quote.pricingSnapshot), card=rec(snapshot.rateCardSnapshot), priced=rec(snapshot.pricing);
 if (card.planId !== validatedPlan.id || card.planCode !== validatedPlan.code || card.basePricePaise !== validatedPlan.annualPricePaise
     || card.billingCycle !== "ANNUAL" || card.currency !== "INR" || card.taxRateBps !== validatedPlan.taxRateBps)
   deny("SCHOOLOS_ADDON_BASE_SNAPSHOT_MISMATCH","Base price changed since signed quote");
 if (!Array.isArray(snapshot.addonRateSnapshot) || snapshot.addonRateSnapshot.length !== quoteItems.length)
   deny("SCHOOLOS_ADDON_RATE_SNAPSHOT_MISSING","Approved rate snapshots required");
 const seen = new Set<string>();
 const lines: SchoolOSApprovedAddonLine[] = quoteItems.map((raw,index)=>{
   const line=rec(raw),snap=rec((snapshot.addonRateSnapshot as unknown[])[index]);
   const category=line.category,code=line.code,key=`${category}:${code}`;
   if (!(category === "MODULE" && moduleCodes.has(String(code))
      || category === "CAPACITY" && capacityCodes.has(String(code))
      || category === "AI_USAGE" && code === "ai_credits"
      || category === "VIDEO_USAGE" && code === "video_minutes")
      || seen.has(key)
      || typeof line.label !== "string" || line.label.length < 2
      || typeof line.quantity !== "number" || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 100_000
      || typeof line.unitPricePaise !== "number" || !Number.isSafeInteger(line.unitPricePaise) || line.unitPricePaise <= 0)
      deny("SCHOOLOS_ADDON_LINE_UNSUPPORTED","Unsupported add-on, quantity or duplicate");
   seen.add(key);
   const rate = rates.find(r=>r.id === snap.rateId);
   if (!rate || rate.status !== "APPROVED" || !rate.approvedAt || !rate.approvedBy
       || rate.approvedBy === rate.createdBy || rate.category !== category || rate.code !== code
       || rate.label !== line.label || rate.currency !== "INR" || rate.taxRateBps !== validatedPlan.taxRateBps
       || rate.unitPricePaise !== line.unitPricePaise || snap.revision !== rate.revision
       || snap.category !== category || snap.code !== code || snap.unitPricePaise !== line.unitPricePaise
       || snap.currency !== "INR" || snap.taxRateBps !== rate.taxRateBps
       || snap.effectiveFrom !== rate.effectiveFrom.toISOString()
       || snap.effectiveUntil !== (rate.effectiveUntil?.toISOString()??null)
       || rate.effectiveFrom.getTime() > quote.createdAt.getTime()
       || (rate.effectiveUntil && rate.effectiveUntil.getTime() < quote.validUntil.getTime()))
     deny("SCHOOLOS_ADDON_RATE_MISMATCH","Quoted price differs from independently approved SKU");
   return { category:category as SchoolOSQuoteItem["category"],code:String(code),label:line.label,
     quantity:line.quantity,unitPricePaise:line.unitPricePaise,rateId:rate!.id,rateRevision:rate!.revision };
 });
 let calculated: ReturnType<typeof calculateSchoolOSQuote>;
 try { calculated=calculateSchoolOSQuote({basePricePaise:validatedPlan.annualPricePaise,items:lines,discountBps:0,taxRateBps:validatedPlan.taxRateBps}); }
 catch { return deny("SCHOOLOS_ADDON_AMOUNT_INVALID","Quote arithmetic invalid"); }
 if (quote.totalPaise !== calculated.totalPaise || quote.subtotalPaise !== calculated.subtotalPaise
    || quote.taxPaise !== calculated.taxPaise || priced.totalPaise !== calculated.totalPaise
    || priced.addonsPaise !== calculated.addonsPaise || priced.basePaise !== calculated.basePaise)
   deny("SCHOOLOS_ADDON_SIGNED_TOTAL_MISMATCH","Signed amount differs from approved quote");
 return { baseAmountPaise:calculated.basePaise,addonsAmountPaise:calculated.addonsPaise,
   taxPaise:calculated.taxPaise,totalPaise:calculated.totalPaise,lines };
}
