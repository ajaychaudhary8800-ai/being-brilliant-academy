export type OffsetType = "REFUND" | "REVERSAL";
export const postgresIntegerMoneyMaxPaise = 2_147_483_647;

export function formatInr(paise: number, locale = "en-IN") {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(paise / 100);
}

export function rupeesToPaise(value: string) {
  const normalized = value.trim().replaceAll(",", "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) throw new Error("Enter a valid amount with no more than two decimal places.");
  const paise = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  if (paise <= 0n) throw new Error("Enter an amount greater than zero.");
  if (paise > BigInt(postgresIntegerMoneyMaxPaise)) throw new Error("Amount cannot exceed ₹21,474,836.47 (2,147,483,647 paise).");
  return Number(paise);
}

export function rupeesToNonNegativePaise(value: string) {
  const normalized = value.trim().replaceAll(",", "");
  if (/^0+(?:\.0{1,2})?$/.test(normalized)) return 0;
  return rupeesToPaise(value);
}

export function payablePaise(fee: { totalPaise: number; discountPaise: number; finePaise: number }) {
  return fee.totalPaise - fee.discountPaise + fee.finePaise;
}

export function outstandingPaise(fee: { totalPaise: number; discountPaise: number; finePaise: number; amountPaidPaise: number }) {
  return Math.max(0, payablePaise(fee) - fee.amountPaidPaise);
}

export function withSelectedLookupItem<T extends { id: string }>(items: T[], selected?: T) {
  return selected && !items.some(item => item.id === selected.id) ? [selected, ...items] : items;
}

export function newFinanceOperationKey(type: OffsetType) {
  return `finance-${type.toLowerCase()}-${crypto.randomUUID()}`;
}

export function financeApiMessage(code: string | undefined, fallback: string) {
  const messages: Record<string, string> = {
    PAYMENT_OFFSET_IDEMPOTENCY_CONFLICT: "This operation key was already used for different refund or reversal details. Close this dialog and start a new operation.",
    PAYMENT_OFFSET_CONFLICT: "The payment changed while this operation was being saved. Reload the fee and try again.",
    PAYMENT_LEDGER_INCONSISTENT: "The payment ledger needs administrator review before an offset can be recorded.",
    PAYMENT_OFFSET_EXCEEDS_ORIGINAL: "The amount exceeds the remaining refundable or reversible balance.",
    BRANCH_FORBIDDEN: "Your branch access changed. Reload this workspace to refresh your permissions.",
    FEE_ASSIGNMENT_FAMILY_EXISTS: "This student already has another version of this Fee Plan family for the academic session.",
    FEE_ASSIGNMENT_INCOMPLETE: "The existing assignment is incomplete. An administrator must review its generated fees.",
    FEE_ASSIGNMENT_CONFLICT: "The assignment changed concurrently. Review the student and try again.",
    FEE_PLAN_IMMUTABLE: "Only draft Fee Plans can be edited.",
  };
  return code && messages[code] ? messages[code] : fallback;
}
