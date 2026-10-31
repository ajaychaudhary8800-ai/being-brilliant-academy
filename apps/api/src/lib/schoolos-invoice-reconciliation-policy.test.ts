import assert from "node:assert/strict";
import test from "node:test";
import { reconcileSchoolOSInvoiceLedger as reconcile, type SchoolOSInvoiceLedger } from "./schoolos-invoice-reconciliation-policy.js";

function ledger(): SchoolOSInvoiceLedger {
  return {
    id: "invoice-test", organizationId: "tenant-test", schoolOSQuoteId: "quote-test",
    provider: "RAZORPAY", providerOrderId: "order_test", status: "PAID",
    amountPaise: 10000, taxPaise: 1800, totalPaise: 11800, currency: "INR",
    schoolOSQuote: { id: "quote-test", organizationId: "tenant-test", totalPaise: 11800 },
    payments: [{ invoiceId: "invoice-test", organizationId: "tenant-test", provider: "RAZORPAY",
      providerPaymentId: "pay_test", status: "CAPTURED", amountPaise: 11800, currency: "INR" }],
    schoolOSPaymentAdjustments: [],
  };
}
function adjustment(type = "refund.processed", id = "rfnd_test", amount = 1800) {
  return { invoiceId: "invoice-test", organizationId: "tenant-test", eventType: type,
    eventKey: `${type}:${id}`, providerEntityId: id, providerPaymentId: "pay_test", amountPaise: amount, currency: "INR" };
}
test("paid invoice reconciles integer paise without claiming provider or tax verification", () => {
  const l = ledger(), before = structuredClone(l), result = reconcile(l);
  assert.equal(result.status, "INTERNAL_AMOUNTS_CONSISTENT");
  assert.equal(result.totals?.capturedPaise, 11800);
  assert.equal(result.totals?.outstandingPaise, null);
  assert.equal(result.providerSettlement, "NOT_VERIFIED");
  assert.equal(result.taxCompliance, "NOT_VERIFIED");
  assert.deepEqual(l, before);
});
test("failed attempts do not inflate cash and partial/full refunds are summed once", () => {
  const l = ledger();
  l.payments.push({ ...l.payments[0], status: "FAILED", providerPaymentId: "pay_failed" });
  l.schoolOSPaymentAdjustments.push(adjustment());
  assert.equal(reconcile(l).totals?.capturedLessRefundsPaise, 10000);
  assert.equal(reconcile(l).counts.failedAttempts, 1);
  l.schoolOSPaymentAdjustments.push(adjustment("refund.processed", "rfnd_remainder", 10000));
  l.payments[0].status = "REFUNDED";
  assert.equal(reconcile(l).totals?.capturedLessRefundsPaise, 0);
});
test("unpaid collectible invoices expose outstanding amount, draft/void do not", () => {
  const l = ledger(); l.payments = [];
  for (const status of ["OPEN", "OVERDUE"]) {
    l.status = status; assert.equal(reconcile(l).totals?.outstandingPaise, 11800);
  }
  for (const status of ["DRAFT", "VOID"]) {
    l.status = status; assert.equal(reconcile(l).totals?.outstandingPaise, null);
  }
});
test("dispute lifecycle callbacks are not added to refund cash totals", () => {
  const l = ledger();
  l.schoolOSPaymentAdjustments.push(adjustment("payment.dispute.created", "disp_test", 11800),
    adjustment("payment.dispute.lost", "disp_test", 11800));
  const result = reconcile(l);
  assert.equal(result.totals?.processedRefundPaise, 0);
  assert.equal(result.disputeReviewRequired, true);
  assert.equal(result.providerSettlement, "NOT_VERIFIED");
});
const invalid: Array<[string, (l: SchoolOSInvoiceLedger) => void, string]> = [
  ["foreign payment", l => { l.payments[0].organizationId = "foreign"; }, "PAYMENT_TENANT_OR_INVOICE_MISMATCH"],
  ["foreign refund", l => { l.schoolOSPaymentAdjustments = [{ ...adjustment(), organizationId: "foreign" }]; }, "ADJUSTMENT_TENANT_OR_INVOICE_MISMATCH"],
  ["foreign quote", l => { l.schoolOSQuote!.organizationId = "foreign"; }, "QUOTE_LINK_MISMATCH"],
  ["invoice arithmetic", l => { l.taxPaise++; }, "INVOICE_TOTAL_MISMATCH"],
  ["unsafe integer", l => { l.amountPaise = Number.MAX_SAFE_INTEGER + 1; }, "INVOICE_TOTAL_MISMATCH"],
  ["missing capture", l => { l.payments = []; }, "PAID_INVOICE_CAPTURE_MISMATCH"],
  ["unsettled capture", l => { l.status = "VOID"; }, "UNSETTLED_INVOICE_HAS_CAPTURE"],
  ["duplicate capture", l => { l.payments.push({ ...l.payments[0] }); }, "DUPLICATE_PAYMENT_ID"],
  ["refund replay", l => { l.schoolOSPaymentAdjustments = [adjustment(), adjustment()]; }, "DUPLICATE_ADJUSTMENT"],
  ["over-refund", l => { l.schoolOSPaymentAdjustments = [adjustment("refund.processed", "rfnd_test", 11801)]; }, "REFUNDS_EXCEED_CAPTURE"],
  ["unlinked refund", l => { l.schoolOSPaymentAdjustments = [{ ...adjustment(), providerPaymentId: "pay_other" }]; }, "ADJUSTMENT_CAPTURE_MISSING"],
  ["wrong currency", l => { l.payments[0].currency = "USD"; }, "PAYMENT_AMOUNT_OR_PROVIDER_MISMATCH"],
  ["oversized dispute", l => { l.schoolOSPaymentAdjustments = [adjustment("payment.dispute.created", "disp_test", 11801)]; }, "ADJUSTMENT_EXCEEDS_CAPTURE"],
  ["fractional paise", l => { l.schoolOSPaymentAdjustments = [adjustment("refund.processed", "rfnd_test", 1.5)]; }, "ADJUSTMENT_AMOUNT_OR_CURRENCY_INVALID"],
  ["incomplete refund ledger", l => { l.payments[0].status = "REFUNDED"; }, "REFUNDED_PAYMENT_ADJUSTMENT_MISMATCH"],
  ["truncated ledger", l => { l.payments = Array.from({length:1001}, (_, i) => ({...l.payments[0], status:"FAILED", providerPaymentId:`pay_failed${i}`})); }, "LEDGER_ROW_LIMIT_EXCEEDED"],
];
for (const [name, mutate, finding] of invalid) test(`${name} requires review and suppresses misleading totals`, () => {
  const l = ledger(); mutate(l);
  const result = reconcile(l);
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.ok(result.findings.includes(finding));
  assert.equal(result.totals, null);
});
