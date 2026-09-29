import assert from "node:assert/strict";
import { test } from "node:test";
import { nextReportRun } from "./report-schedule-time.js";

test("a delayed daily job advances to its next slot without sending missed runs", () => {
  const next = nextReportRun({ frequency: "DAILY", nextRunAt: new Date("2026-09-01T04:30:00Z") }, new Date("2026-09-03T05:00:00Z"));
  assert.equal(next.toISOString(), "2026-09-04T04:30:00.000Z");
});

test("monthly jobs retain the chosen day after a short month", () => {
  const next = nextReportRun({ frequency: "MONTHLY", nextRunAt: new Date("2027-01-31T04:30:00Z"), cronExpression: "0 10 31 * *" }, new Date("2027-02-28T05:00:00Z"));
  assert.equal(next.toISOString(), "2027-03-31T04:30:00.000Z");
});

test("weekly schedules keep the intended time", () => {
  const next = nextReportRun({ frequency: "WEEKLY", nextRunAt: new Date("2026-09-01T04:30:00Z") }, new Date("2026-09-08T04:30:00Z"));
  assert.equal(next.toISOString(), "2026-09-15T04:30:00.000Z");
});

test("daily schedules keep local time when daylight saving changes", () => {
  const next = nextReportRun({ frequency: "DAILY", timezone: "America/New_York", nextRunAt: new Date("2026-03-07T14:00:00Z") }, new Date("2026-03-07T14:00:00Z"));
  assert.equal(next.toISOString(), "2026-03-08T13:00:00.000Z");
});

test("monthly reports honor the local calendar day", () => {
  const next = nextReportRun({ frequency: "MONTHLY", timezone: "Asia/Kolkata", cronExpression: "15 0 31 * *", nextRunAt: new Date("2027-01-30T18:45:00Z") }, new Date("2027-02-28T18:45:00Z"));
  assert.equal(next.toISOString(), "2027-03-30T18:45:00.000Z");
});
