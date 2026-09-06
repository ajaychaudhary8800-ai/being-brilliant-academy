import assert from "node:assert/strict";
import test from "node:test";
import { homeworkCreateDateTimes, homeworkUpdateDateTimes, isIanaTimeZone, parseDateOnly, parseInstitutionDateTime } from "./institution-time.js";

test("institution-local Homework time is converted exactly once to UTC", () => {
  const dueDate = parseInstitutionDateTime("2026-09-08T10:00", "Asia/Calcutta");
  assert.equal(dueDate.toISOString(), "2026-09-08T04:30:00.000Z");
  assert.notEqual(dueDate.toISOString(), "2026-09-07T23:00:00.000Z");
});

test("Homework create and edit use the same institution-local datetime contract", () => {
  const created = homeworkCreateDateTimes({ assignedDate: "2026-09-08", dueDate: "2026-09-08T10:00" }, "Asia/Calcutta");
  const updated = homeworkUpdateDateTimes({ dueDate: "2026-09-08T10:00" }, "Asia/Calcutta", created);
  assert.equal(created.assignedDate.toISOString(), "2026-09-08T00:00:00.000Z");
  assert.equal(created.dueDate.toISOString(), "2026-09-08T04:30:00.000Z");
  assert.equal(updated.dueDate?.toISOString(), created.dueDate.toISOString());
});

test("date-only values remain UTC calendar dates", () => {
  assert.equal(parseDateOnly("2026-09-08").toISOString(), "2026-09-08T00:00:00.000Z");
});

test("invalid and nonexistent institution-local datetimes are rejected", () => {
  assert.throws(() => parseInstitutionDateTime("2026-02-30T10:00", "Asia/Calcutta"), (error: any) => error.code === "INVALID_INSTITUTION_DATETIME");
  assert.throws(() => parseInstitutionDateTime("2026-03-08T02:30", "America/New_York"), (error: any) => error.code === "INVALID_INSTITUTION_DATETIME");
  assert.throws(() => parseInstitutionDateTime("2026-11-01T01:30", "America/New_York"), (error: any) => error.code === "INVALID_INSTITUTION_DATETIME");
});

test("an invalid authoritative Organization timezone rejects Homework mutation parsing", () => {
  assert.equal(isIanaTimeZone("Asia/Calcutta"), true);
  assert.equal(isIanaTimeZone("Invalid/Timezone"), false);
  assert.throws(
    () => homeworkCreateDateTimes({ assignedDate: "2026-09-08", dueDate: "2026-09-08T10:00" }, "Invalid/Timezone"),
    (error: any) => error.status === 500 && error.code === "INVALID_ORGANIZATION_TIMEZONE",
  );
});

test("only named IANA identifiers are accepted", () => {
  for (const zone of ["Asia/Calcutta", "Asia/Kolkata", "America/New_York", "Europe/London", "UTC"]) {
    assert.equal(isIanaTimeZone(zone), true);
  }
  for (const zone of ["+05:30", "-04:00", "UTC+05:30", "GMT+5", "Invalid/Timezone", "random-string"]) {
    assert.equal(isIanaTimeZone(zone), false);
  }
});

test("correct and legacy edit round-trips remain stable for five cycles", () => {
  for (const initial of ["2026-09-08T04:30:00.000Z", "2026-09-08T10:00:00.000Z"]) {
    let stored = initial;
    for (let cycle = 0; cycle < 5; cycle += 1) {
      const input = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Calcutta", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(stored)).reduce((parts, part) => ({ ...parts, [part.type]: part.value }), {} as Record<string, string>);
      stored = parseInstitutionDateTime(`${input.year}-${input.month}-${input.day}T${input.hour}:${input.minute}`, "Asia/Calcutta").toISOString();
    }
    assert.equal(stored, initial);
  }
});

test("DST-capable IANA zones convert unambiguous wall-clock times correctly", () => {
  assert.equal(parseInstitutionDateTime("2026-07-15T10:00", "America/New_York").toISOString(), "2026-07-15T14:00:00.000Z");
  assert.equal(parseInstitutionDateTime("2026-01-15T10:00", "America/New_York").toISOString(), "2026-01-15T15:00:00.000Z");
});

const zone = "Asia/Calcutta";
const existing = { assignedDate: parseDateOnly("2026-09-08"), dueDate: parseInstitutionDateTime("2026-09-08T10:00", zone) };
const invalidOrder = (error: any) => error.status === 422 && error.code === "INVALID_DUE_DATE";
const invalidZone = (error: any) => error.status === 500 && error.code === "INVALID_ORGANIZATION_TIMEZONE";

for (const dueDate of ["2026-09-08T00:00", "2026-09-08T00:01", "2026-09-08T04:00", "2026-09-08T23:59", "2026-09-09T00:00"]) {
  test(`create accepts institution-calendar deadline ${dueDate}`, () => {
    assert.doesNotThrow(() => homeworkCreateDateTimes({ assignedDate: "2026-09-08", dueDate }, zone));
  });
}
test("create rejects the previous institution-calendar day", () => {
  assert.throws(() => homeworkCreateDateTimes({ assignedDate: "2026-09-08", dueDate: "2026-09-07T23:59" }, zone), invalidOrder);
});
test("assignedDate-only update validates against retained dueDate without rewriting it", () => {
  const old = { ...existing, assignedDate: parseDateOnly("2026-09-07") };
  const patch = homeworkUpdateDateTimes({ assignedDate: "2026-09-08" }, zone, old);
  assert.deepEqual(patch, { assignedDate: existing.assignedDate });
  assert.throws(() => homeworkUpdateDateTimes({ assignedDate: "2026-09-09" }, zone, old), invalidOrder);
});
test("dueDate-only update validates against retained assignedDate", () => {
  assert.deepEqual(homeworkUpdateDateTimes({ dueDate: "2026-09-08T04:00" }, zone, existing), { dueDate: new Date("2026-09-07T22:30:00.000Z") });
  assert.throws(() => homeworkUpdateDateTimes({ dueDate: "2026-09-07T23:59" }, zone, existing), invalidOrder);
});
test("both-field update validates the incoming effective pair", () => {
  assert.deepEqual(homeworkUpdateDateTimes({ assignedDate: "2026-09-09", dueDate: "2026-09-09T00:01" }, zone, existing), homeworkCreateDateTimes({ assignedDate: "2026-09-09", dueDate: "2026-09-09T00:01" }, zone));
  assert.throws(() => homeworkUpdateDateTimes({ assignedDate: "2026-09-09", dueDate: "2026-09-08T23:59" }, zone, existing), invalidOrder);
});
for (const patch of [{ assignedDate: "2026-09-08" }, { dueDate: "2026-09-08T10:00" }, { assignedDate: "2026-09-08", dueDate: "2026-09-08T10:00" }]) {
  test(`invalid timezone rejects update fields ${Object.keys(patch).join(", ")}`, () => {
    assert.throws(() => homeworkUpdateDateTimes(patch, "Invalid/Timezone", existing), invalidZone);
  });
}
test("metadata-only update skips date validation and preserves historical timestamps", () => {
  const historical = { ...existing, assignedDate: parseDateOnly("2026-09-09") };
  assert.deepEqual(homeworkUpdateDateTimes({}, "Invalid/Timezone", historical), {});
  assert.deepEqual(homeworkUpdateDateTimes({}, zone, historical), {});
});
test("Calcutta rollover does not compare date-only UTC midnight against an instant", () => {
  const dates = homeworkCreateDateTimes({ assignedDate: "2026-09-08", dueDate: "2026-09-08T04:00" }, zone);
  assert.equal(dates.dueDate.toISOString(), "2026-09-07T22:30:00.000Z");
  assert.ok(dates.dueDate.getTime() < dates.assignedDate.getTime());
});
test("New York rollover rejects the prior local day even when UTC dates match", () => {
  const dates = homeworkCreateDateTimes({ assignedDate: "2026-09-08", dueDate: "2026-09-08T23:59" }, "America/New_York");
  assert.equal(dates.dueDate.toISOString(), "2026-09-09T03:59:00.000Z");
  assert.throws(() => homeworkCreateDateTimes({ assignedDate: "2026-09-08", dueDate: "2026-09-07T23:59" }, "America/New_York"), invalidOrder);
});
test("DST transition dates compare using local calendars before and after clock changes", () => {
  for (const dueDate of ["2026-03-08T00:01", "2026-03-08T03:01", "2026-11-01T00:01", "2026-11-01T02:01"]) {
    assert.doesNotThrow(() => homeworkCreateDateTimes({ assignedDate: dueDate.slice(0, 10), dueDate }, "America/New_York"));
  }
});
