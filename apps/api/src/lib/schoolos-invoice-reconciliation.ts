import { Prisma } from "@prisma/client";
import { AppError } from "./http.js";
import { systemPrisma } from "./prisma.js";
import { reconcileSchoolOSInvoiceLedger, SCHOOL_OS_RECONCILIATION_ROW_LIMIT } from "./schoolos-invoice-reconciliation-policy.js";

/** Caller must authorize platform finance access. No provider call or database mutation. */
export async function readSchoolOSInvoiceReconciliation(invoiceId: string) {
  return systemPrisma.$transaction(async tx => {
    const invoice = await tx.saaSInvoice.findUnique({ where: { id: invoiceId }, select: {
      id: true, organizationId: true, schoolOSQuoteId: true, status: true,
      provider: true, providerOrderId: true, amountPaise: true, taxPaise: true, totalPaise: true, currency: true,
      schoolOSQuote: { select: { id: true, organizationId: true, status: true, totalPaise: true } },
      schoolOSPaymentRiskHold: { select: { organizationId: true, status: true } },
      payments: { take: SCHOOL_OS_RECONCILIATION_ROW_LIMIT + 1, orderBy: { id: "asc" }, select: {
        invoiceId: true, organizationId: true, provider: true, providerPaymentId: true,
        status: true, amountPaise: true, currency: true,
      } },
      schoolOSPaymentAdjustments: { take: SCHOOL_OS_RECONCILIATION_ROW_LIMIT + 1, orderBy: { id: "asc" }, select: {
        invoiceId: true, organizationId: true, eventType: true, eventKey: true,
        providerEntityId: true, providerPaymentId: true, amountPaise: true, currency: true,
      } },
    } });
    if (!invoice || !invoice.schoolOSQuoteId)
      throw new AppError(404, "SCHOOLOS_INVOICE_NOT_FOUND", "SchoolOS quotation invoice not found");
    return reconcileSchoolOSInvoiceLedger(invoice);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
