import assert from "node:assert/strict";
import test from "node:test";
import { FeePaymentOffsetType, FeeStatus } from "@prisma/client";
import { institutionCalendarDate } from "./institution-time.js";
import { financeOperationsSummary } from "./fee-reporting.js";

test("finance operations summary uses canonical payable, effective paid and immutable offsets", () => {
  const summary = financeOperationsSummary([
    { totalPaise: 10_000, discountPaise: 1_000, finePaise: 500, amountPaidPaise: 6_000, dueDate: new Date("2026-09-01"), status: FeeStatus.PARTIAL },
    { totalPaise: 5_000, discountPaise: 0, finePaise: 0, amountPaidPaise: 5_000, dueDate: new Date("2026-10-01"), status: FeeStatus.PAID },
    { totalPaise: 2_000, discountPaise: 0, finePaise: 0, amountPaidPaise: 0, dueDate: new Date("2026-10-01"), status: FeeStatus.PENDING },
  ], 15_000, [
    { type: FeePaymentOffsetType.REFUND, amountPaise: 3_000 },
    { type: FeePaymentOffsetType.REVERSAL, amountPaise: 1_000 },
  ], "2026-09-12");
  assert.deepEqual(summary, {
    records: 3,
    totalReceivablePaise: 16_500,
    effectiveCollectedPaise: 11_000,
    outstandingPaise: 5_500,
    overdueAmountPaise: 3_500,
    paidFees: 1,
    partialFees: 1,
    pendingFees: 1,
    overdueFees: 1,
    grossCollectedPaise: 15_000,
    refundsPaise: 3_000,
    reversalsPaise: 1_000,
    netEffectiveCollectionPaise: 11_000,
  });
});

test("finance operations summary treats null aggregates as zero", () => {
  assert.equal(financeOperationsSummary([], 0, [{ type: FeePaymentOffsetType.REFUND, amountPaise: null }], "2026-09-12").netEffectiveCollectionPaise, 0);
});

test("overdue classification follows the institution calendar near UTC midnight", () => {
  const instant = new Date("2026-09-12T20:00:00.000Z");
  const fee = (dueDate: string, amountPaidPaise = 0) => ({
    totalPaise: 10_000,
    discountPaise: 0,
    finePaise: 0,
    amountPaidPaise,
    dueDate: new Date(`${dueDate}T00:00:00.000Z`),
    status: amountPaidPaise === 10_000 ? FeeStatus.PAID : FeeStatus.PENDING,
  });
  const overdue = (timeZone: string, dueDate: string, amountPaidPaise = 0) => financeOperationsSummary(
    [fee(dueDate, amountPaidPaise)],
    0,
    [],
    institutionCalendarDate(instant, timeZone),
  );

  assert.equal(overdue("Asia/Kolkata", "2026-09-12").overdueFees, 1);
  assert.equal(overdue("Asia/Kolkata", "2026-09-13").overdueFees, 0);
  assert.equal(overdue("UTC", "2026-09-12").overdueFees, 0);
  assert.equal(overdue("UTC", "2026-09-11").overdueFees, 1);
  assert.equal(overdue("America/New_York", "2026-09-12").overdueFees, 0);
  assert.equal(overdue("America/New_York", "2026-09-11").overdueFees, 1);
  assert.equal(overdue("Asia/Kolkata", "2026-09-12", 10_000).overdueFees, 0);
  assert.equal(overdue("Asia/Kolkata", "2026-09-12", 10_000).overdueAmountPaise, 0);
});
