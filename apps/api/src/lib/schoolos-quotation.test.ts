import assert from "node:assert/strict";
import test from "node:test";
import { calculateSchoolOSQuote, type SchoolOSQuoteItem } from "./schoolos-quotation.js";

const item: SchoolOSQuoteItem = { category: "MODULE", code: "analytics", label: "Analytics", quantity: 1, unitPricePaise: 100000 };

test("quote arithmetic uses integer paise, discount before GST and correct INR totals", () => {
  const result = calculateSchoolOSQuote({ basePricePaise: 4990000, items: [item], discountBps: 500, taxRateBps: 1800 });
  assert.equal(result.subtotalPaise, 5090000);
  assert.equal(result.discountPaise, 254500);
  assert.equal(result.netPaise, 4835500);
  assert.equal(result.taxPaise, 870390);
  assert.equal(result.totalPaise, 5705890);
});

test("fractional GST rounding is deterministic in paise", () => {
  const result = calculateSchoolOSQuote({ basePricePaise: 101, items: [], discountBps: 0, taxRateBps: 1800 });
  assert.equal(result.taxPaise, 18);
  assert.equal(result.totalPaise, 119);
});

test("overflow and duplicate items cannot be persisted as malformed monetary totals", () => {
  assert.throws(() => calculateSchoolOSQuote({ basePricePaise: 2_147_483_647, items: [item], discountBps: 0, taxRateBps: 0 }), /supported invoice amount/);
  assert.throws(() => calculateSchoolOSQuote({ basePricePaise: 1000, items: [item, item], discountBps: 0, taxRateBps: 0 }), /Duplicate quote item/);
});

test("rejects negative and fractional financial inputs", () => {
  assert.throws(() => calculateSchoolOSQuote({ basePricePaise: -1, items: [], discountBps: 0, taxRateBps: 0 }));
  assert.throws(() => calculateSchoolOSQuote({ basePricePaise: 1000.4, items: [], discountBps: 0, taxRateBps: 0 }));
  assert.throws(() => calculateSchoolOSQuote({ basePricePaise: 1000, items: [{ ...item, quantity: 1.4 }], discountBps: 0, taxRateBps: 0 }));
});
