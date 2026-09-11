/**
 * Executable design contracts for V2 phases. These are deliberately types and
 * documentation only: Phase 0 does not add production tables or alter schema.
 */
export const v2Phase0Contracts = {
  financeRefund: [
    "FeePayment is immutable historical evidence",
    "refunds and reversals are separate append-only records",
    "partial refunds are supported",
    "cumulative refunds cannot exceed refundable amount",
    "provider refund identity is idempotent",
    "balances derive from payments minus reversals",
    "receipts and reports distinguish payments from reversals",
    "accounting REFUND is not a provider payment reversal",
  ],
  academicPromotion: [
    "historical enrollment remains preserved",
    "promotion records source enrollment/session and destination",
    "organization and branch consistency is mandatory",
    "promotion never mutates historical attendance or examination records",
    "promotion supports preview before commit",
    "duplicate active enrollment is prevented",
  ],
  communicationDelivery: [
    "one logical communication has explicit target recipients",
    "each provider channel has delivery attempts",
    "delivery is idempotent and retryable",
    "permanent failures are represented as dead-letter state",
    "scheduled delivery and provider response metadata are auditable",
  ],
} as const;

export type V2Phase0Contract = keyof typeof v2Phase0Contracts;
