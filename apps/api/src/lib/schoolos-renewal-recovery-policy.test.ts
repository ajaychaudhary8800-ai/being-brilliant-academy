import assert from "node:assert/strict";
import test from "node:test";
import { classifyRenewalRecovery } from "./schoolos-renewal-recovery-policy.js";
test("empty invoices require no recovery", () => {
  assert.equal(classifyRenewalRecovery([]).state, "NONE");
});
