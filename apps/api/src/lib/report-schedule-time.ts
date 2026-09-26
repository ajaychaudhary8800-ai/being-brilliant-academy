type ScheduleTime = { frequency: string; nextRunAt: Date; cronExpression?: string; timezone?: string };

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}

function localToUtc(parts: ReturnType<typeof localParts>, timezone: string) {
  const desired = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let guess = desired;
  for (let i = 0; i < 5; i++) {
    const actual = localParts(new Date(guess), timezone);
    const observed = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    if (observed === desired) break;
    guess += desired - observed;
  }
  return new Date(guess);
}

export function nextReportRun(schedule: ScheduleTime, now: Date): Date {
  const timezone = schedule.timezone ?? "UTC";
  let next = new Date(schedule.nextRunAt);
  const original = localParts(next, timezone);
  const recordedDay = Number(schedule.cronExpression?.split(" ")[2]);
  const monthlyDay = Number.isInteger(recordedDay) && recordedDay >= 1 && recordedDay <= 31 ? recordedDay : original.day;
  // Advance from the original local time so delays and daylight saving do not move future slots.
  for (let i = 0; i < 370; i++) {
    if (next > now) return next;
    const local = localParts(next, timezone);
    const calendar = new Date(Date.UTC(local.year, local.month - 1, local.day));
    if (schedule.frequency === "DAILY") calendar.setUTCDate(calendar.getUTCDate() + 1);
    else if (schedule.frequency === "WEEKLY") calendar.setUTCDate(calendar.getUTCDate() + 7);
    else if (schedule.frequency === "MONTHLY") {
      calendar.setUTCDate(1);
      calendar.setUTCMonth(calendar.getUTCMonth() + 1);
      const lastDay = new Date(Date.UTC(calendar.getUTCFullYear(), calendar.getUTCMonth() + 1, 0)).getUTCDate();
      calendar.setUTCDate(Math.min(monthlyDay, lastDay));
    } else throw new Error("Invalid analytics report frequency");
    next = localToUtc({ year: calendar.getUTCFullYear(), month: calendar.getUTCMonth() + 1, day: calendar.getUTCDate(), hour: original.hour, minute: original.minute, second: original.second }, timezone);
  }
  throw new Error("Could not calculate the next analytics report run");
}
