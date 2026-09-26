import assert from "node:assert/strict";
import { test } from "node:test";
import { feeOutstanding, notificationActionConfig, parseTriggerConfig } from "./automation-rule.js";

test("fee automation config applies safe defaults", () => {
  assert.deepEqual(parseTriggerConfig("FEE_OVERDUE", {}), { daysOverdue: 0, minBalancePaise: 0 });
});

test("homework preview window is bounded", () => {
  assert.throws(() => parseTriggerConfig("HOMEWORK_DUE_SOON", { dueWithinHours: 169 }));
  assert.deepEqual(parseTriggerConfig("HOMEWORK_DUE_SOON", { dueWithinHours: 48 }), { dueWithinHours: 48 });
});

test("notification channels are de-duplicated", () => {
  assert.deepEqual(notificationActionConfig.parse({
    channels: ["IN_APP", "EMAIL", "EMAIL"],
    title: "Reminder",
    body: "Please review this item.",
  }).channels, ["IN_APP", "EMAIL"]);
});

test("fee outstanding balance never becomes negative", () => {
  assert.equal(feeOutstanding(10000, 1000, 500, 4000), 5500);
  assert.equal(feeOutstanding(10000, 0, 0, 12000), 0);
});
