import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultInstitutionTimeZone,
  formatInstitutionDate,
  formatInstitutionDateTime,
  formatInstitutionTime,
  institutionDateTimeInput,
  institutionWeekday,
  invalidInstitutionDateDisplay,
} from "./institution-time";

const settings = { timeZone: "Asia/Calcutta", locale: "en-IN" };

test("existing Asia/Calcutta settings remain compatible with Asia/Kolkata", () => {
  const instant = "2026-09-08T04:30:00.000Z";
  assert.equal(
    formatInstitutionDateTime(instant, { timeZone: "Asia/Calcutta", locale: "en-IN" }),
    formatInstitutionDateTime(instant, { timeZone: "Asia/Kolkata", locale: "en-IN" }),
  );
});

test("the stored UTC Homework deadline renders at the intended institution-local time", () => {
  const rendered = formatInstitutionDateTime("2026-09-08T04:30:00.000Z", settings);
  assert.match(rendered, /10:00/);
  assert.doesNotMatch(rendered, /15:30|20:00/);
});

test("Teacher and Admin edit inputs receive institution-local wall-clock values", () => {
  assert.equal(institutionDateTimeInput("2026-09-08T04:30:00.000Z", settings.timeZone), "2026-09-08T10:00");
});

test("formatting is explicit and independent of the browser or process timezone", () => {
  assert.equal(institutionDateTimeInput("2026-07-15T14:00:00.000Z", "America/New_York"), "2026-07-15T10:00");
  assert.equal(institutionDateTimeInput("2026-01-15T15:00:00.000Z", "America/New_York"), "2026-01-15T10:00");
});

test("invalid or missing institution settings never crash Homework rendering or edit preparation", () => {
  assert.equal(formatInstitutionDateTime("not-a-date", settings), invalidInstitutionDateDisplay);
  assert.equal(institutionDateTimeInput("not-a-date", settings.timeZone), "");
  assert.equal(
    formatInstitutionDateTime("2026-09-08T04:30:00.000Z", { timeZone: "Invalid/Timezone", locale: "Invalid/Locale" }),
    formatInstitutionDateTime("2026-09-08T04:30:00.000Z", { timeZone: defaultInstitutionTimeZone, locale: "en-IN" }),
  );
  assert.equal(institutionDateTimeInput("2026-09-08T04:30:00.000Z", "Invalid/Timezone"), "2026-09-08T10:00");
  assert.equal(institutionDateTimeInput("2026-09-08T04:30:00.000Z", undefined), "2026-09-08T10:00");
});

test("date-only Homework values preserve their calendar day across browser timezones", () => {
  const originalTimeZone = process.env.TZ;
  try {
    process.env.TZ = "America/Los_Angeles";
    assert.equal(formatInstitutionDate("2026-09-06", "en-US"), "Sep 6, 2026");
    assert.equal(formatInstitutionDate("2026-09-06T00:00:00.000Z", "en-US"), "Sep 6, 2026");
    process.env.TZ = "Asia/Calcutta";
    assert.equal(formatInstitutionDate("2026-09-06", "en-US"), "Sep 6, 2026");
    assert.equal(formatInstitutionDate("2026-09-06T00:00:00.000Z", "en-US"), "Sep 6, 2026");
  } finally {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  }
});

test("submission instants use institution time and remain browser independent", () => {
  const instant = "2026-09-08T04:30:00.000Z";
  const settings = { timeZone: "Asia/Calcutta", locale: "en-IN" };
  const expected = formatInstitutionDateTime(instant, settings);
  for (const browserZone of ["UTC", "America/Los_Angeles", "Asia/Calcutta"]) {
    process.env.TZ = browserZone;
    assert.equal(formatInstitutionDateTime(instant, settings), expected);
  }
  assert.match(expected, /10:00/);
  assert.equal(formatInstitutionDateTime("not-a-date", settings), invalidInstitutionDateDisplay);
  assert.equal(formatInstitutionDateTime(instant, { timeZone: "Invalid/Timezone", locale: "Invalid/Locale" }), formatInstitutionDateTime(instant, { timeZone: defaultInstitutionTimeZone, locale: "en-IN" }));
});

test("attendance clock times render in institution time across UTC boundaries", () => {
  assert.match(formatInstitutionTime("2026-09-07T22:45:00.000Z", settings), /4:15/);
  assert.match(formatInstitutionTime("2026-09-08T18:45:00.000Z", settings), /12:15/);
  assert.equal(formatInstitutionTime("not-a-date", settings), invalidInstitutionDateDisplay);
});

test("timetable current day follows the institution across the UTC date boundary", () => {
  const instant = "2026-09-06T20:00:00.000Z";
  assert.equal(institutionWeekday(instant, "UTC"), "SUNDAY");
  assert.equal(institutionWeekday(instant, "Asia/Calcutta"), "MONDAY");
  assert.equal(institutionWeekday("invalid", "Asia/Calcutta"), "");
});

test("UTC runtime preserves the assigned calendar day", () => {
  const original = process.env.TZ;
  process.env.TZ = "UTC";
  assert.equal(formatInstitutionDate("2026-09-06T00:00:00.000Z", "en-US"), "Sep 6, 2026");
  if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
});
