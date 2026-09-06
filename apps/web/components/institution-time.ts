export type InstitutionRegionalSettings = { timeZone?: string | null; locale?: string | null };

export const defaultInstitutionTimeZone = "Asia/Calcutta";
export const defaultInstitutionLocale = "en-IN";
export const invalidInstitutionDateDisplay = "Invalid date";

function resolvedTimeZone(value?: string | null) {
  if (value) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
      return value;
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  }
  return defaultInstitutionTimeZone;
}

function resolvedLocale(value?: string | null) {
  if (value) {
    try {
      new Intl.DateTimeFormat(value).format(0);
      return value;
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  }
  return defaultInstitutionLocale;
}

function validInstant(value: string | Date) {
  const instant = value instanceof Date ? value : new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

export function formatInstitutionDateTime(value: string | Date, settings: InstitutionRegionalSettings) {
  const instant = validInstant(value);
  if (!instant) return invalidInstitutionDateDisplay;
  return new Intl.DateTimeFormat(resolvedLocale(settings.locale), {
    timeZone: resolvedTimeZone(settings.timeZone),
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}

export function institutionDateTimeInput(value: string | Date, timeZone?: string | null) {
  const instant = validInstant(value);
  if (!instant) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: resolvedTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.000)?Z)?$/;

export function formatInstitutionDate(value: string, locale?: string | null) {
  const match = dateOnlyPattern.exec(value);
  if (!match) return invalidInstitutionDateDisplay;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return invalidInstitutionDateDisplay;
  return new Intl.DateTimeFormat(resolvedLocale(locale), {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}
