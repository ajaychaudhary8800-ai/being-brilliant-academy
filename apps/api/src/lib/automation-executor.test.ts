import assert from "node:assert/strict";
import { test } from "node:test";
import { effectiveAutomationChannels, nextAutomationEligibility } from "./automation-executor.js";

test("automation execution respects notification preferences", () => {
  assert.deepEqual(effectiveAutomationChannels(["IN_APP", "EMAIL"], { inApp: true, email: false }), ["IN_APP"]);
  assert.deepEqual(effectiveAutomationChannels(["IN_APP", "EMAIL"], { inApp: false, email: false }), []);
  assert.deepEqual(effectiveAutomationChannels(["IN_APP", "EMAIL"], null), ["IN_APP", "EMAIL"]);
});

test("automation cooldown computes the next eligible timestamp", () => {
  const now = new Date("2026-09-27T00:00:00.000Z");
  assert.equal(nextAutomationEligibility(now, 60).toISOString(), "2026-09-27T01:00:00.000Z");
});
