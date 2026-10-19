export type RenewalInvoice = {
 id: string; status: string; schoolOSQuoteId: string | null;
 providerOrderId: string | null; dueAt: Date | null;
 periodStart: Date; periodEnd: Date;
};

export function classifyRenewalRecovery(invoices: RenewalInvoice[], now = new Date()) {
 const pending = invoices.filter(i => i.status === "OPEN" && i.schoolOSQuoteId)
   .sort((a,b) => b.periodStart.getTime() - a.periodStart.getTime())[0];
 if (!pending) return { state: "NONE", invoiceId: null };
 const overlap = invoices.some(i => i.id !== pending.id && i.status === "PAID" &&
   i.periodStart < pending.periodEnd && i.periodEnd > pending.periodStart);
 if (overlap) return { state: "FINANCE_REVIEW", invoiceId: pending.id };
 if (pending.providerOrderId && (!pending.dueAt || pending.dueAt <= now))
   return { state: "ORDER_EXPIRED", invoiceId: pending.id };
 if (pending.providerOrderId) return { state: "AWAITING_CAPTURE", invoiceId: pending.id };
 return { state: "INCOMPLETE_CHECKOUT", invoiceId: pending.id };
}
