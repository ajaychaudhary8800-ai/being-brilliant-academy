import { schoolOSDisputeReleasePolicy } from "./schoolos-dispute-release-policy.js";

/** Internal ledger arithmetic only. Never certifies provider/bank settlement or tax compliance. */
export type SchoolOSInvoiceLedger = {
  id: string; organizationId: string; schoolOSQuoteId: string | null;
  provider: string | null; providerOrderId: string | null; status: string;
  amountPaise: number; taxPaise: number; totalPaise: number; currency: string;
  schoolOSQuote: { id: string; organizationId: string | null; status: string; totalPaise: number } | null;
  schoolOSPaymentRiskHold: { organizationId: string; status: string } | null;
  payments: Array<{
    invoiceId: string; organizationId: string; provider: string; providerPaymentId: string | null;
    status: string; amountPaise: number; currency: string;
  }>;
  schoolOSPaymentAdjustments: Array<{
    invoiceId: string; organizationId: string; eventType: string; eventKey: string;
    providerEntityId: string; providerPaymentId: string; amountPaise: number; currency: string;
  }>;
};

export const SCHOOL_OS_RECONCILIATION_ROW_LIMIT = 1000;

export function reconcileSchoolOSInvoiceLedger(invoice: SchoolOSInvoiceLedger) {
  const findings = new Set<string>();
  const money = (n: number, positive = false) => Number.isSafeInteger(n) && (positive ? n > 0 : n >= 0);
  if (!money(invoice.amountPaise) || !money(invoice.taxPaise) || !money(invoice.totalPaise, true)
    || !Number.isSafeInteger(invoice.amountPaise + invoice.taxPaise)
    || invoice.amountPaise + invoice.taxPaise !== invoice.totalPaise) findings.add("INVOICE_TOTAL_MISMATCH");
  if (invoice.currency !== "INR" || invoice.provider !== "RAZORPAY" || !invoice.providerOrderId)
    findings.add("INVOICE_PROVIDER_OR_CURRENCY_INVALID");
  if (!invoice.schoolOSQuote || invoice.schoolOSQuote.id !== invoice.schoolOSQuoteId
    || invoice.schoolOSQuote.organizationId !== invoice.organizationId
    || invoice.schoolOSQuote.totalPaise !== invoice.totalPaise) findings.add("QUOTE_LINK_MISMATCH");
  if (!["DRAFT", "OPEN", "OVERDUE", "PAID", "VOID"].includes(invoice.status)) findings.add("INVOICE_STATE_INVALID");
  // The signed-quotation checkout moves PAYMENT_PENDING -> PAID atomically
  // with the invoice. Report state drift instead of showing reconciled cash.
  if (invoice.schoolOSQuote && ((invoice.status === "PAID" && invoice.schoolOSQuote.status !== "PAID")
    || (["OPEN", "OVERDUE"].includes(invoice.status) && invoice.schoolOSQuote.status !== "PAYMENT_PENDING")
    || (["DRAFT", "VOID"].includes(invoice.status) && invoice.schoolOSQuote.status === "PAID")))
    findings.add("INVOICE_QUOTE_SETTLEMENT_STATE_CONFLICT");
  if (invoice.schoolOSPaymentRiskHold &&
    (invoice.schoolOSPaymentRiskHold.organizationId !== invoice.organizationId ||
      !["ACTIVE", "RESOLVED"].includes(invoice.schoolOSPaymentRiskHold.status)))
    findings.add("RISK_HOLD_TENANT_OR_STATE_INVALID");
  // Risk holds are created only by verified adjustments against a PAID
  // quotation. A hold on an unpaid/void invoice is not reconciled cash.
  if (invoice.schoolOSPaymentRiskHold && invoice.status !== "PAID")
    findings.add("RISK_HOLD_INVOICE_NOT_PAID");
  if (invoice.schoolOSPaymentAdjustments.length > 0 && !invoice.schoolOSPaymentRiskHold)
    findings.add("RISK_HOLD_MISSING_FOR_ADJUSTMENTS");
  // Release is permitted only for independently reviewed, matching won disputes.
  // A resolved hold with a refund, lost/unresolved dispute or no eligible source
  // event contradicts the actual maker-checker risk-release policy. Do not show
  // it as financially reconciled even when the arithmetic itself balances.
  if (invoice.schoolOSPaymentRiskHold?.status === "RESOLVED" &&
      !schoolOSDisputeReleasePolicy(invoice.schoolOSPaymentAdjustments).allowed)
    findings.add("RISK_HOLD_RELEASE_EVIDENCE_INVALID");
  if (invoice.payments.length > SCHOOL_OS_RECONCILIATION_ROW_LIMIT
    || invoice.schoolOSPaymentAdjustments.length > SCHOOL_OS_RECONCILIATION_ROW_LIMIT)
    findings.add("LEDGER_ROW_LIMIT_EXCEEDED");

  const captured = new Map<string, number>();
  const paymentIds = new Set<string>();
  let gross = 0, refunds = 0, failedAttempts = 0, captures = 0, refundCount = 0, disputeEvents = 0;
  for (const p of invoice.payments) {
    if (p.invoiceId !== invoice.id || p.organizationId !== invoice.organizationId)
      findings.add("PAYMENT_TENANT_OR_INVOICE_MISMATCH");
    if (p.provider !== "RAZORPAY" || p.currency !== "INR" || !money(p.amountPaise, true)
      || p.amountPaise !== invoice.totalPaise) findings.add("PAYMENT_AMOUNT_OR_PROVIDER_MISMATCH");
    if (p.providerPaymentId) {
      if (paymentIds.has(p.providerPaymentId)) findings.add("DUPLICATE_PAYMENT_ID");
      paymentIds.add(p.providerPaymentId);
    }
    if (p.status === "FAILED") failedAttempts++;
    else if (p.status === "CAPTURED" || p.status === "REFUNDED") {
      captures++;
      gross += p.amountPaise;
      if (!p.providerPaymentId) findings.add("CAPTURE_ID_MISSING");
      else captured.set(p.providerPaymentId, p.amountPaise);
    } else if (p.status !== "CREATED") findings.add("PAYMENT_STATE_INVALID");
  }
  if (!Number.isSafeInteger(gross)) findings.add("AMOUNT_OVERFLOW");
  if (invoice.status === "PAID" && (captures !== 1 || gross !== invoice.totalPaise))
    findings.add("PAID_INVOICE_CAPTURE_MISMATCH");
  if (invoice.status !== "PAID" && captures > 0) findings.add("UNSETTLED_INVOICE_HAS_CAPTURE");

  const eventKeys = new Set<string>(), entities = new Set<string>();
  const refundByPayment = new Map<string, number>();
  for (const a of invoice.schoolOSPaymentAdjustments) {
    if (a.invoiceId !== invoice.id || a.organizationId !== invoice.organizationId)
      findings.add("ADJUSTMENT_TENANT_OR_INVOICE_MISMATCH");
    if (a.currency !== "INR" || !money(a.amountPaise, true)) findings.add("ADJUSTMENT_AMOUNT_OR_CURRENCY_INVALID");
    if (!captured.has(a.providerPaymentId)) findings.add("ADJUSTMENT_CAPTURE_MISSING");
    else if (a.amountPaise > captured.get(a.providerPaymentId)!) findings.add("ADJUSTMENT_EXCEEDS_CAPTURE");
    if (a.eventKey !== `${a.eventType}:${a.providerEntityId}`) findings.add("ADJUSTMENT_EVENT_KEY_MISMATCH");
    const identity = `${a.eventType}:${a.providerEntityId}`;
    if (eventKeys.has(a.eventKey) || entities.has(identity)) findings.add("DUPLICATE_ADJUSTMENT");
    eventKeys.add(a.eventKey); entities.add(identity);
    if (a.eventType === "refund.processed") {
      refunds += a.amountPaise; refundCount++;
      refundByPayment.set(a.providerPaymentId, (refundByPayment.get(a.providerPaymentId) ?? 0) + a.amountPaise);
    } else if (["payment.dispute.created", "payment.dispute.won", "payment.dispute.lost"].includes(a.eventType)) {
      // Created and outcome callbacks describe the same dispute, not separate cash debits.
      disputeEvents++;
    } else findings.add("ADJUSTMENT_TYPE_UNSUPPORTED");
  }
  if (!Number.isSafeInteger(refunds)) findings.add("AMOUNT_OVERFLOW");
  // A lost/won notification records the disposition of a previously raised
  // dispute; it is not independent proof of a new dispute. Even an ACTIVE
  // finance hold must not be labelled internally consistent when the source
  // dispute is missing/mismatched or both contradictory outcomes are present.
  // Unresolved created-only disputes remain review-required via the hold.
  const raisedDisputes = invoice.schoolOSPaymentAdjustments.filter(a =>
    a.eventType === "payment.dispute.created");
  const disputeOutcomes = invoice.schoolOSPaymentAdjustments.filter(a =>
    a.eventType === "payment.dispute.won" || a.eventType === "payment.dispute.lost");
  for (const outcome of disputeOutcomes) {
    if (!raisedDisputes.some(source =>
      source.providerEntityId === outcome.providerEntityId &&
      source.providerPaymentId === outcome.providerPaymentId &&
      source.amountPaise === outcome.amountPaise))
      findings.add("DISPUTE_OUTCOME_SOURCE_MISMATCH");
    if (disputeOutcomes.some(other =>
      other !== outcome && other.providerEntityId === outcome.providerEntityId &&
      other.eventType !== outcome.eventType))
      findings.add("DISPUTE_OUTCOME_CONFLICT");
  }
  for (const [id, amount] of refundByPayment) {
    if (!Number.isSafeInteger(amount) || amount > (captured.get(id) ?? 0)) findings.add("REFUNDS_EXCEED_CAPTURE");
  }
  for (const p of invoice.payments) {
    if (p.status === "REFUNDED" && (refundByPayment.get(p.providerPaymentId ?? "") ?? 0) !== p.amountPaise)
      findings.add("REFUNDED_PAYMENT_ADJUSTMENT_MISMATCH");
  }
  const consistent = findings.size === 0;
  return {
    invoiceId: invoice.id,
    invoiceStatus: invoice.status,
    financeHoldStatus: invoice.schoolOSPaymentRiskHold?.status ?? null,
    // An inconsistent ledger MUST never signal that finance review is unnecessary.
    financeReviewRequired: !consistent || invoice.schoolOSPaymentRiskHold?.status === "ACTIVE" || disputeEvents > 0,
    status: consistent ? "INTERNAL_AMOUNTS_CONSISTENT" : "REVIEW_REQUIRED",
    findings: [...findings].sort(),
    providerSettlement: "NOT_VERIFIED", taxCompliance: "NOT_VERIFIED",
    disputeReviewRequired: disputeEvents > 0,
    counts: { captures, failedAttempts, refundCount, disputeEvents },
    // Never present partial, foreign, duplicated or unsafe arithmetic as usable financial totals.
    totals: consistent ? {
      invoiceTotalPaise: invoice.totalPaise, capturedPaise: gross, processedRefundPaise: refunds,
      capturedLessRefundsPaise: gross - refunds,
      outstandingPaise: ["OPEN", "OVERDUE"].includes(invoice.status) ? invoice.totalPaise - gross : null,
      currency: "INR",
    } : null,
    basis: "STORED_LEDGER_ONLY_EXCLUDES_PROVIDER_FEES_DISPUTE_SETTLEMENT_AND_CREDIT_NOTES",
  };
}
