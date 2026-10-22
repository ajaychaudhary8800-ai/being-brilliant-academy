import { AppError } from "./http.js";

export type SchoolOSPaidTerm = {
  id: string; periodStart: Date; periodEnd: Date; status: string; schoolOSQuoteId: string | null;
};
export type SchoolOSCreditPeriod = {
  metric: string; periodStart: Date; periodEnd: Date; grantedUnits: number; consumedUnits: number;
};
export type SchoolOSBillingHealth = {
  subscriptionStatus: string; subscriptionEnd: Date | null; cancelAtPeriodEnd: boolean;
};
export function assertSchoolOSNewTermDoesNotOverlap(
  terms: SchoolOSPaidTerm[], proposedStart: Date, proposedEnd: Date,
): void {
  if (!Number.isFinite(proposedStart.getTime()) || !Number.isFinite(proposedEnd.getTime())
      || proposedStart.getTime()>=proposedEnd.getTime())
    throw new AppError(422,"SCHOOLOS_RENEWAL_PERIOD_INVALID","The requested subscription billing term is invalid");
  const overlapping=terms.find(term=>term.status==="PAID" &&
    term.periodStart.getTime()<proposedEnd.getTime() && term.periodEnd.getTime()>proposedStart.getTime());
  if(overlapping)
    throw new AppError(409,"SCHOOLOS_RENEWAL_PAID_PERIOD_OVERLAP",
      "An existing paid subscription period overlaps this signed quote. Proration and early renewals require an independently approved renewal workflow.");
}
export function schoolOSRenewalReadiness(
  terms: SchoolOSPaidTerm[], billing: SchoolOSBillingHealth | null, credits: SchoolOSCreditPeriod[], now = new Date(),
) {
  const paid=terms.filter(term=>term.status==="PAID")
    .sort((a,b)=>b.periodEnd.getTime()-a.periodEnd.getTime());
  const current=paid.find(term=>term.periodStart<=now && term.periodEnd>now);
  const upcoming=paid.find(term=>term.periodStart>now);
  const latest=paid[0]??null;
  const activeTermEndsAt=current?.periodEnd??null;
  const nextRenewalAt=activeTermEndsAt??latest?.periodEnd??null;
  const daysUntilRenewal=nextRenewalAt ? Math.ceil((nextRenewalAt.getTime()-now.getTime())/86400000):null;
  const canceled=Boolean(billing?.cancelAtPeriodEnd);
  const paidUntil=latest?.periodEnd??null;
  return {
    status:current?"PAID_TERM_ACTIVE":upcoming?"PAID_TERM_NOT_STARTED":latest?"PAID_TERM_EXPIRED":"NO_PAID_TERM",
    currentInvoiceId:current?.id??null,
    activeTermEndsAt,nextRenewalAt,paidUntil,daysUntilRenewal,
    cancelAtPeriodEnd:canceled,
    checkoutRecommendation:current?"BLOCK_OVERLAPPING_CHECKOUT":upcoming?"REVIEW_FUTURE_TERM":"REQUIRE_NEW_SIGNED_QUOTE",
    subscriptionStatus:billing?.subscriptionStatus??null,
    subscriptionEndsAt:billing?.subscriptionEnd??null,
    credits:credits.map(credit=>{
      const remaining=credit.grantedUnits-credit.consumedUnits;
      const usable=credit.periodStart<=now && credit.periodEnd>now &&
        Boolean(current && credit.periodEnd<=current.periodEnd);
      return {
        metric:credit.metric,periodStart:credit.periodStart,periodEnd:credit.periodEnd,
        purchasedUnits:credit.grantedUnits,consumedUnits:credit.consumedUnits,
        ledgerRemainingUnits:remaining,usableNowUnits:usable?Math.max(0,remaining):0,
        expiresAt:credit.periodEnd,expired:credit.periodEnd<=now,
        rolloverPermitted:false,
      };
    }),
    automaticRenewalEnabled:false,
    earlyRenewalCheckoutEnabled:false,
    prorationSupported:false,
    expiredCreditsCarryOver:false,
  };
}
