import { FeePaymentOffsetType, FeeStatus } from "@prisma/client";

export type FeeReportingRow = {
  totalPaise: number;
  discountPaise: number;
  finePaise: number;
  amountPaidPaise: number;
  dueDate: Date;
  status: FeeStatus;
};

export type OffsetReportingRow = { type: FeePaymentOffsetType; amountPaise: number | null };

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);

export function financeOperationsSummary(fees: FeeReportingRow[], grossCollectedPaise: number, offsets: OffsetReportingRow[], institutionToday: string) {
  const refundsPaise = offsets.filter(item => item.type === FeePaymentOffsetType.REFUND).reduce((sum, item) => sum + Number(item.amountPaise ?? 0), 0);
  const reversalsPaise = offsets.filter(item => item.type === FeePaymentOffsetType.REVERSAL).reduce((sum, item) => sum + Number(item.amountPaise ?? 0), 0);
  let totalReceivablePaise = 0;
  let effectiveCollectedPaise = 0;
  let outstandingPaise = 0;
  let overdueAmountPaise = 0;
  let paidFees = 0;
  let partialFees = 0;
  let pendingFees = 0;
  let overdueFees = 0;
  for (const fee of fees) {
    const payable = fee.totalPaise - fee.discountPaise + fee.finePaise;
    const outstanding = Math.max(0, payable - fee.amountPaidPaise);
    const overdue = outstanding > 0 && dateOnly(fee.dueDate) < institutionToday;
    totalReceivablePaise += payable;
    effectiveCollectedPaise += fee.amountPaidPaise;
    outstandingPaise += outstanding;
    if (overdue) { overdueFees++; overdueAmountPaise += outstanding; }
    if (fee.status === FeeStatus.PAID) paidFees++;
    else if (fee.status === FeeStatus.PARTIAL) partialFees++;
    else if (fee.status === FeeStatus.PENDING) pendingFees++;
  }
  return {
    records: fees.length,
    totalReceivablePaise,
    effectiveCollectedPaise,
    outstandingPaise,
    overdueAmountPaise,
    paidFees,
    partialFees,
    pendingFees,
    overdueFees,
    grossCollectedPaise,
    refundsPaise,
    reversalsPaise,
    netEffectiveCollectionPaise: grossCollectedPaise - refundsPaise - reversalsPaise,
  };
}
