import assert from "node:assert/strict";
import test from "node:test";
import { v2Phase0Contracts } from "./v2-phase0-contracts.js";

test("V2 Phase 0 records the non-schema contracts required by later phases", () => {
  assert.ok(v2Phase0Contracts.financeRefund.includes("FeePayment is immutable historical evidence"));
  assert.ok(v2Phase0Contracts.financeRefund.includes("accounting REFUND is not a provider payment reversal"));
  assert.ok(v2Phase0Contracts.academicPromotion.includes("promotion supports preview before commit"));
  assert.ok(v2Phase0Contracts.academicPromotion.includes("promotion never mutates historical attendance or examination records"));
  assert.ok(v2Phase0Contracts.communicationDelivery.includes("delivery is idempotent and retryable"));
  assert.ok(v2Phase0Contracts.communicationDelivery.includes("permanent failures are represented as dead-letter state"));
});
