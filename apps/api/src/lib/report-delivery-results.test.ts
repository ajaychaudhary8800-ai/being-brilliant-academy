import assert from "node:assert/strict";
import { test } from "node:test";
import { retryRecipients, summarizeDelivery } from "./report-delivery-results.js";

test("delivery is SENT only when every recipient succeeds", () => {
  assert.equal(summarizeDelivery([
    { recipient: "a@example.com", status: "SENT" },
    { recipient: "b@example.com", status: "SENT" },
  ]), "SENT");
});

test("delivery is PARTIAL when recipient outcomes are mixed", () => {
  assert.equal(summarizeDelivery([
    { recipient: "a@example.com", status: "SENT" },
    { recipient: "b@example.com", status: "FAILED", error: "SMTP" },
  ]), "PARTIAL");
});

test("retry targets only failed recipients from the latest delivery", () => {
  assert.deepEqual(retryRecipients({
    status: "PARTIAL",
    recipientResults: [
      { recipient: "a@example.com", status: "SENT" },
      { recipient: "b@example.com", status: "FAILED" },
      { recipient: "b@example.com", status: "FAILED" },
    ],
  }, ["a@example.com", "b@example.com"]), ["b@example.com"]);
});

test("legacy failed delivery retries the configured recipients", () => {
  assert.deepEqual(retryRecipients({ status: "FAILED" }, ["a@example.com", "b@example.com"]), ["a@example.com", "b@example.com"]);
});
