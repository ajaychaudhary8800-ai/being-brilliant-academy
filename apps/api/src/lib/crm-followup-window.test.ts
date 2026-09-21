import assert from "node:assert/strict";
import test from "node:test";
import { CRM_FOLLOW_UP_UPCOMING_HOURS, enquiryFollowUpWindow } from "./crm-followup-window.js";

test("CRM upcoming follow-up window is exactly the next 24 hours", () => {
  const now = new Date("2026-09-22T00:00:00.000Z");
  assert.equal(CRM_FOLLOW_UP_UPCOMING_HOURS, 24);
  assert.deepEqual(enquiryFollowUpWindow("upcoming", now), {
    gte: now,
    lte: new Date("2026-09-23T00:00:00.000Z"),
  });
});

test("CRM due follow-up window contains only overdue follow-ups", () => {
  const now = new Date("2026-09-22T00:00:00.000Z");
  assert.deepEqual(enquiryFollowUpWindow("due", now), { lt: now });
});

test("CRM dashboard, list and export all use the same reminder window helper", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../routes/admin-enquiries.ts", import.meta.url), "utf8"),
  );
  const uses = source.match(/enquiryFollowUpWindow\(/g) ?? [];
  assert.ok(uses.length >= 4);
  assert.doesNotMatch(source, /q\.reminder==="due"\?\{lte:now\}:\{gt:now\}/);
});
