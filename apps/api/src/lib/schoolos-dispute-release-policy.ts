export type SchoolOSRiskLedgerEvent = {
  eventType: string;
  providerEntityId: string;
  providerPaymentId: string;
  amountPaise: number;
};

export function schoolOSDisputeReleasePolicy(events: SchoolOSRiskLedgerEvent[]) {
  // Under NO circumstances release on a completed refund, lost dispute, missing
  // source dispute, unresolved dispute or conflicting provider notification.
  if (events.some(e => e.eventType === "refund.processed"))
    return { allowed: false, reason: "PROCESSED_REFUND_EXISTS" as const };
  if (events.some(e => e.eventType === "payment.dispute.lost"))
    return { allowed: false, reason: "LOST_DISPUTE_EXISTS" as const };
  const raised = events.filter(e => e.eventType === "payment.dispute.created");
  if (!raised.length)
    return { allowed: false, reason: "NO_DISPUTE_TO_RECONCILE" as const };
  for (const dispute of raised) {
    const outcomes = events.filter(e =>
      e.providerEntityId === dispute.providerEntityId
      && e.providerPaymentId === dispute.providerPaymentId
      && e.amountPaise === dispute.amountPaise
      && e.eventType === "payment.dispute.won");
    if (outcomes.length !== 1)
      return { allowed: false, reason: "DISPUTE_NOT_INDEPENDENTLY_WON" as const };
  }
  if (events.some(e => e.eventType === "payment.dispute.won"
      && !raised.some(open => open.providerEntityId === e.providerEntityId
        && open.providerPaymentId === e.providerPaymentId && open.amountPaise === e.amountPaise)))
    return { allowed: false, reason: "UNLINKED_DISPUTE_OUTCOME" as const };
  return { allowed: true, reason: "ALL_DISPUTES_WON_NO_REFUNDS" as const };
}
