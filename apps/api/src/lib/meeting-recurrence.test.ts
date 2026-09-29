import assert from "node:assert/strict";
import test from "node:test";
import { generateMeetingOccurrences, parseMeetingRecurrenceRule } from "./meeting-recurrence.js";

test("parses safe meeting recurrence rules", () => {
  assert.deepEqual(parseMeetingRecurrenceRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=4"), {
    freq:"WEEKLY", interval:2, count:4, until:undefined, byDay:["MO","WE"],
  });
});

test("weekly recurrence preserves local time", () => {
  const rows=generateMeetingOccurrences({
    startsAt:new Date("2026-10-05T04:30:00.000Z"),
    endsAt:new Date("2026-10-05T05:30:00.000Z"),
    timezone:"Asia/Kolkata",
    rule:"FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4",
  });
  assert.equal(rows.length,4);
  assert.equal(rows[0].startsAt.toISOString(),"2026-10-05T04:30:00.000Z");
  assert.equal(rows[1].startsAt.toISOString(),"2026-10-07T04:30:00.000Z");
  assert.equal(rows[2].startsAt.toISOString(),"2026-10-12T04:30:00.000Z");
  assert.equal(rows[3].startsAt.toISOString(),"2026-10-14T04:30:00.000Z");
});

test("monthly recurrence clamps month-end dates", () => {
  const rows=generateMeetingOccurrences({
    startsAt:new Date("2027-01-31T03:30:00.000Z"),
    endsAt:new Date("2027-01-31T04:00:00.000Z"),
    timezone:"Asia/Kolkata",
    rule:"FREQ=MONTHLY;COUNT=3",
  });
  assert.equal(rows.length,3);
  assert.equal(rows[1].startsAt.toISOString(),"2027-02-28T03:30:00.000Z");
  assert.equal(rows[2].startsAt.toISOString(),"2027-03-31T03:30:00.000Z");
});
