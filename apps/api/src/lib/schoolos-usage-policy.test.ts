import assert from "node:assert/strict";
import test from "node:test";
import { paidQuoteAddonGrantItems, assertSchoolOSUsageRequest, isSchoolOSUsageMetric } from "./schoolos-usage-policy.js";

const invoice = { organizationId: "school-a", id: "invoice-1", status: "PAID", currency: "INR",
  schoolOSQuoteId: "quote-a", paidAt: new Date("2026-10-18"), totalPaise: 200000 };
const quote = { id: "quote-a", organizationId: "school-a", status: "PAID", totalPaise: 200000,
  items: [{ category: "AI_USAGE", code: "ai_credits", label: "AI", quantity: 100, unitPricePaise: 500 },
    { category: "VIDEO_USAGE", code: "video_minutes", label: "Video", quantity: 50, unitPricePaise: 500 }],
  pricingSnapshot: { pricing: { totalPaise: 200000 } },
};
const payment = { invoiceId: "invoice-1", status: "CAPTURED", amountPaise: 200000, currency: "INR", providerPaymentId: "pay_123" };
test("paid and exact quote recognizes only finite catalogued AI/video credits", () => {
  assert.deepEqual(paidQuoteAddonGrantItems(invoice, quote, payment), [
    { metric: "ai_credits", units: 100 }, { metric: "video_minutes", units: 50 },
  ]);
  assert.equal(isSchoolOSUsageMetric("storage_gb"), false);
});
test("unpaid, cross-tenant and modified quote can never mint credits", () => {
  assert.throws(() => paidQuoteAddonGrantItems({ ...invoice, status: "OPEN" }, quote, payment), /EVIDENCE_REQUIRED/);
  assert.throws(() => paidQuoteAddonGrantItems(invoice, { ...quote, organizationId: "school-b" }, payment), /EVIDENCE_REQUIRED/);
  assert.throws(() => paidQuoteAddonGrantItems(invoice, { ...quote, pricingSnapshot: {} }, payment), /SNAPSHOT_MISMATCH/);
  assert.throws(() => paidQuoteAddonGrantItems(invoice, quote, { ...payment, amountPaise: 1 }), /PAYMENT_MISMATCH/);
});
test("invalid metering codes, zero-price and duplicate credit items are rejected", () => {
  assert.throws(() => paidQuoteAddonGrantItems(invoice, { ...quote, items: [{ category: "AI_USAGE", code: "invented", quantity: 4, unitPricePaise: 50 }] }, payment), /USAGE_ITEM_UNSUPPORTED/);
  assert.throws(() => paidQuoteAddonGrantItems(invoice, { ...quote, items: [{ ...quote.items[0], unitPricePaise: 0 }] }, payment), /USAGE_ITEM_UNSUPPORTED/);
  assert.throws(() => paidQuoteAddonGrantItems(invoice, { ...quote, items: [quote.items[0], quote.items[0]] }, payment), /USAGE_ITEM_UNSUPPORTED/);
});
test("usage input is bounded and requires durable service-level request ID", () => {
  assert.deepEqual(assertSchoolOSUsageRequest({ metric: "ai_credits", units: 2, requestKey: "assessment:123" }).units, 2);
  assert.throws(() => assertSchoolOSUsageRequest({ metric: "video_minutes", units: 0, requestKey: "livekit:123" }));
  assert.throws(() => assertSchoolOSUsageRequest({ metric: "ai_credits", units: 1, requestKey: "short" }));
});
