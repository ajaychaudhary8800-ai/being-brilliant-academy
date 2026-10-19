import { AppError } from "./http.js";

export type SchoolOSFailedPaymentEvidence = {
  providerPaymentId: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  errorCode?: string | null;
};

export function validateSchoolOSFailedPayment(e: SchoolOSFailedPaymentEvidence) {
  if (!/^pay_[A-Za-z0-9]+$/.test(e.providerPaymentId) ||
      !/^order_[A-Za-z0-9]+$/.test(e.orderId))
    throw new AppError(422, "SCHOOLOS_FAILED_PAYMENT_ID_INVALID", "Invalid payment failure identifiers");
  if (!Number.isSafeInteger(e.amountPaise) || e.amountPaise <= 0 || e.amountPaise > 2_147_483_647 ||
      e.currency.toUpperCase() !== "INR")
    throw new AppError(422, "SCHOOLOS_FAILED_PAYMENT_AMOUNT_INVALID", "Payment failure amount or currency does not match INR billing");
  if (e.errorCode !== undefined && e.errorCode !== null &&
      !/^[A-Za-z0-9_.-]{1,80}$/.test(e.errorCode))
    throw new AppError(422, "SCHOOLOS_FAILED_PAYMENT_CODE_INVALID", "Invalid payment failure reason code");
  return {
    providerPaymentId: e.providerPaymentId,
    orderId: e.orderId,
    amountPaise: e.amountPaise,
    currency: "INR" as const,
    errorCode: e.errorCode ?? null,
  };
}

export type SchoolOSRecoveryInvoice = {
  id: string;
  invoiceNo: string;
  schoolOSQuoteId: string | null;
  providerOrderId: string | null;
  dueAt: Date | null;
  failedAttempts: number;
} | null;

/** Reporting only; never creates an order, extends access or issues a refund. */
export function schoolOSPaymentRecoverySnapshot(
  invoice: SchoolOSRecoveryInvoice,
  activeFinanceHold: boolean,
  now = new Date(),
) {
  const status = !invoice ? "NO_PENDING_ORDER"
    : activeFinanceHold ? "FINANCE_HOLD"
    : !invoice.providerOrderId || !invoice.dueAt || invoice.dueAt.getTime() <= now.getTime()
      ? "MANUAL_RECONCILIATION_REQUIRED"
      : invoice.failedAttempts > 0 ? "RETRY_EXISTING_ORDER" : "AWAITING_PAYMENT";
  return {
    status,
    invoiceId: invoice?.id ?? null,
    invoiceNo: invoice?.invoiceNo ?? null,
    quoteId: invoice?.schoolOSQuoteId ?? null,
    dueAt: invoice?.dueAt ?? null,
    failedAttempts: invoice?.failedAttempts ?? 0,
    retryExistingOrderAllowed: status === "RETRY_EXISTING_ORDER" || status === "AWAITING_PAYMENT",
    createNewOrderAllowed: false,
    checkoutPath: status === "RETRY_EXISTING_ORDER" || status === "AWAITING_PAYMENT"
      ? "/organization/subscription/contracted-checkout" : null,
    financeReconciliationRequired: status === "MANUAL_RECONCILIATION_REQUIRED" || status === "FINANCE_HOLD",
    gracePeriodDays: 0,
    unpaidAccessExtensionEnabled: false,
  };
}
