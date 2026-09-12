import assert from "node:assert/strict";
import test from "node:test";
import { financeApiMessage, formatInr, newFinanceOperationKey, outstandingPaise, postgresIntegerMoneyMaxPaise, rupeesToNonNegativePaise, rupeesToPaise, withSelectedLookupItem } from "./finance-domain";

test("finance money input converts decimal text to integer paise without floating-point arithmetic", () => {
  assert.equal(rupeesToPaise("1,234.56"), 123_456);
  assert.equal(rupeesToPaise("100"), 10_000);
  assert.equal(rupeesToPaise("0.01"), 1);
  assert.throws(() => rupeesToPaise("1.005"));
  assert.throws(() => rupeesToPaise("0"));
  assert.equal(rupeesToNonNegativePaise("0.00"), 0);
  assert.match(formatInr(123_456), /1,234\.56/);
});

test("finance money input enforces the PostgreSQL INTEGER ceiling", () => {
  assert.equal(rupeesToPaise("21474836.47"), postgresIntegerMoneyMaxPaise);
  assert.throws(() => rupeesToPaise("21474836.48"), /2,147,483,647 paise/);
  assert.throws(() => rupeesToPaise("1.001"), /two decimal places/);
  assert.equal(rupeesToNonNegativePaise("0"), 0);
  assert.throws(() => rupeesToNonNegativePaise("21474836.48"), /2,147,483,647 paise/);
});

test("outstanding uses canonical payable less effective paid", () => {
  assert.equal(outstandingPaise({ totalPaise: 10_000, discountPaise: 1_000, finePaise: 500, amountPaidPaise: 6_000 }), 3_500);
});

test("each genuinely new offset intent receives a stable unique key", () => {
  const first = newFinanceOperationKey("REFUND");
  const second = newFinanceOperationKey("REFUND");
  assert.match(first, /^finance-refund-/);
  assert.notEqual(first, second);
});

test("finance errors are translated into operational guidance", () => {
  assert.match(financeApiMessage("PAYMENT_LEDGER_INCONSISTENT", "fallback"), /administrator review/);
  assert.equal(financeApiMessage(undefined, "fallback"), "fallback");
});

test("student lookup retains a selected student when later server results change", () => {
  const selected = { id: "student-125", name: "Student 125" };
  assert.deepEqual(withSelectedLookupItem([{ id: "student-2", name: "Student 2" }], selected), [selected, { id: "student-2", name: "Student 2" }]);
  assert.deepEqual(withSelectedLookupItem([selected], selected), [selected]);
});
