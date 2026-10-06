import assert from "node:assert/strict";
import test from "node:test";
import { verifyAccountingStatement } from "./ai-examiner-accounting-verifier.js";

test("trial balance verifier checks debit-credit equality and expected rows", () => {
  const result = verifyAccountingStatement({
    response: JSON.stringify({
      headings: ["Trial Balance"],
      rows: [
        { label: "Cash", debit: 1000, side: "DEBIT" },
        { label: "Capital", credit: 1000, side: "CREDIT" },
      ],
    }),
    config: {
      format: "TRIAL_BALANCE",
      requireBalanced: true,
      requiredHeadings: ["Trial Balance"],
      expectedRows: [
        { label: "Cash", required: true, debit: 1000, side: "DEBIT" },
        { label: "Capital", required: true, credit: 1000, side: "CREDIT" },
      ],
    },
  });

  assert.equal(result.parsed, true);
  assert.equal(result.reviewRequired, true);
  assert.equal(result.totals.debit, 1000);
  assert.equal(result.totals.credit, 1000);
  assert.equal(result.checks.find(row => row.criterion === "Debit-credit balance")?.status, "PASS");
  assert.equal(result.checks.find(row => row.criterion === "Heading: Trial Balance")?.status, "PASS");
});

test("unbalanced accounting statement is flagged deterministically", () => {
  const result = verifyAccountingStatement({
    response: JSON.stringify({
      rows: [
        { label: "Cash", debit: 1000 },
        { label: "Capital", credit: 900 },
      ],
    }),
    config: { format: "TRIAL_BALANCE", requireBalanced: true },
  });
  assert.equal(result.checks[0]?.status, "FAIL");
});

test("malformed or unstructured accounting extraction fails closed to review", () => {
  const result = verifyAccountingStatement({
    response: "Cash Dr 1000, Capital Cr 1000",
    config: { format: "TRIAL_BALANCE", requireBalanced: true },
  });
  assert.equal(result.parsed, false);
  assert.equal(result.checks[0]?.status, "REVIEW");
});

test("numeric strings with separators are accepted in structured extraction", () => {
  const result = verifyAccountingStatement({
    response: JSON.stringify({
      rows: [
        { label: "Sales", credit: "1,250.50" },
        { label: "Cash", debit: "1,250.50" },
      ],
    }),
    config: { format: "JOURNAL", requireBalanced: true },
  });
  assert.equal(result.checks[0]?.status, "PASS");
});

test("missing required accounting rows or side classifications are flagged", () => {
  const result = verifyAccountingStatement({
    response: JSON.stringify({
      rows: [{ label: "Cash", amount: 500 }],
    }),
    config: {
      format: "BALANCE_SHEET",
      expectedRows: [
        { label: "Cash", amount: 500, side: "ASSET" },
        { label: "Capital", required: true, amount: 500, side: "LIABILITY" },
      ],
    },
  });
  assert.equal(result.checks.find(row => row.criterion === "Row Cash: side")?.status, "FAIL");
  assert.equal(result.checks.find(row => row.criterion === "Required row: Capital")?.status, "FAIL");
});
