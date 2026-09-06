import { AppError } from "./http.js";

type LocalDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const localDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIanaTimeZone(timeZone: string) {
  if (timeZone !== "UTC" && !/^[A-Za-z]+(?:[._-][A-Za-z0-9]+)*(?:\/[A-Za-z0-9_+.-]+)+$/.test(timeZone)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function assertIanaTimeZone(timeZone: string) {
  if (!isIanaTimeZone(timeZone)) throw new AppError(500, "INVALID_ORGANIZATION_TIMEZONE", "The organization timezone is not valid");
  return timeZone;
}

function partsAt(instant: Date, timeZone: string): LocalDateTimeParts {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant).filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
  return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute };
}

function sameParts(left: LocalDateTimeParts, right: LocalDateTimeParts) {
  return left.year === right.year && left.month === right.month && left.day === right.day && left.hour === right.hour && left.minute === right.minute;
}

function validCalendarParts(parts: LocalDateTimeParts) {
  const value = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute));
  return value.getUTCFullYear() === parts.year
    && value.getUTCMonth() === parts.month - 1
    && value.getUTCDate() === parts.day
    && value.getUTCHours() === parts.hour
    && value.getUTCMinutes() === parts.minute;
}

function offsetAt(instantMs: number, timeZone: string) {
  const instant = new Date(instantMs);
  const local = partsAt(instant, timeZone);
  return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute) - Math.floor(instantMs / 60_000) * 60_000;
}

export function parseInstitutionDateTime(value: string, timeZone: string) {
  assertIanaTimeZone(timeZone);
  const match = localDateTimePattern.exec(value);
  if (!match) throw new AppError(422, "INVALID_INSTITUTION_DATETIME", "Use a valid local date and time in YYYY-MM-DDTHH:mm format");
  const target: LocalDateTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
  if (!validCalendarParts(target)) throw new AppError(422, "INVALID_INSTITUTION_DATETIME", "Use a valid local date and time");

  const wallClockMs = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute);
  const offsets = new Set([-172_800_000, -86_400_000, 0, 86_400_000, 172_800_000].map(delta => offsetAt(wallClockMs + delta, timeZone)));
  const matches = [...offsets]
    .map(offset => new Date(wallClockMs - offset))
    .filter(candidate => sameParts(partsAt(candidate, timeZone), target));

  if (matches.length !== 1) {
    const detail = matches.length ? "The selected local time is ambiguous in the organization timezone" : "The selected local time does not exist in the organization timezone";
    throw new AppError(422, "INVALID_INSTITUTION_DATETIME", detail);
  }
  return matches[0];
}

export function parseDateOnly(value: string) {
  const match = dateOnlyPattern.exec(value);
  if (!match) throw new AppError(422, "INVALID_DATE", "Use a valid date in YYYY-MM-DD format");
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: 0, minute: 0 };
  if (!validCalendarParts(parts)) throw new AppError(422, "INVALID_DATE", "Use a valid calendar date");
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

export function homeworkCreateDateTimes(input: { assignedDate: string; dueDate: string }, timeZone: string) {
  assertIanaTimeZone(timeZone);
  const dates = { assignedDate: parseDateOnly(input.assignedDate), dueDate: parseInstitutionDateTime(input.dueDate, timeZone) };
  assertHomeworkDateOrder(dates, timeZone);
  return dates;
}

type HomeworkDates = { assignedDate: Date; dueDate: Date };

export function institutionCalendarDate(instant: Date, timeZone: string) {
  assertIanaTimeZone(timeZone);
  const { year, month, day } = partsAt(instant, timeZone);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function assertHomeworkDateOrder(dates: HomeworkDates, timeZone: string) {
  // assignedDate stores a calendar date; only dueDate represents an instant.
  if (institutionCalendarDate(dates.dueDate, timeZone) < dates.assignedDate.toISOString().slice(0, 10)) {
    throw new AppError(422, "INVALID_DUE_DATE", "Due date must not be before assigned date in the organization timezone");
  }
}

export function homeworkUpdateDateTimes(input: { assignedDate?: string; dueDate?: string }, timeZone: string, existing: HomeworkDates) {
  if (input.assignedDate === undefined && input.dueDate === undefined) return {};
  assertIanaTimeZone(timeZone);
  const patch = {
    ...(input.assignedDate === undefined ? {} : { assignedDate: parseDateOnly(input.assignedDate) }),
    ...(input.dueDate === undefined ? {} : { dueDate: parseInstitutionDateTime(input.dueDate, timeZone) }),
  };
  assertHomeworkDateOrder({ ...existing, ...patch }, timeZone);
  return patch;
}
