import { AppError } from "./http.js";

type Frequency = "DAILY" | "WEEKLY" | "MONTHLY";
type DayCode = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export type MeetingRecurrenceRule = {
  freq: Frequency;
  interval: number;
  count?: number;
  until?: Date;
  byDay?: DayCode[];
};

const dayIndex: Record<DayCode, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseUntil(value: string) {
  if (/^\d{8}T\d{6}Z$/.test(value)) {
    const y=Number(value.slice(0,4)),m=Number(value.slice(4,6)),d=Number(value.slice(6,8)),h=Number(value.slice(9,11)),mi=Number(value.slice(11,13)),s=Number(value.slice(13,15));
    return new Date(Date.UTC(y,m-1,d,h,mi,s));
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new AppError(422, "MEETING_RECURRENCE_INVALID", "Invalid RRULE UNTIL value");
  return parsed;
}

export function parseMeetingRecurrenceRule(rule: string): MeetingRecurrenceRule {
  const pairs = new Map(rule.trim().toUpperCase().split(";").filter(Boolean).map(part => {
    const i = part.indexOf("=");
    if (i < 1) throw new AppError(422, "MEETING_RECURRENCE_INVALID", "Invalid recurrence rule");
    return [part.slice(0,i), part.slice(i+1)] as const;
  }));
  const freq = pairs.get("FREQ") as Frequency | undefined;
  if (!freq || !["DAILY","WEEKLY","MONTHLY"].includes(freq)) throw new AppError(422, "MEETING_RECURRENCE_INVALID", "Recurrence supports DAILY, WEEKLY or MONTHLY frequency");
  const interval = pairs.has("INTERVAL") ? Number(pairs.get("INTERVAL")) : 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 52) throw new AppError(422, "MEETING_RECURRENCE_INVALID", "RRULE INTERVAL must be between 1 and 52");
  const count = pairs.has("COUNT") ? Number(pairs.get("COUNT")) : undefined;
  if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > 366)) throw new AppError(422, "MEETING_RECURRENCE_INVALID", "RRULE COUNT must be between 1 and 366");
  const until = pairs.get("UNTIL") ? parseUntil(pairs.get("UNTIL")!) : undefined;
  const byDay = pairs.get("BYDAY")?.split(",").filter(Boolean) as DayCode[] | undefined;
  if (byDay?.some(code => !(code in dayIndex))) throw new AppError(422, "MEETING_RECURRENCE_INVALID", "RRULE BYDAY contains an unsupported day");
  if (freq !== "WEEKLY" && byDay?.length) throw new AppError(422, "MEETING_RECURRENCE_INVALID", "BYDAY is supported only for WEEKLY meeting recurrence");
  return { freq, interval, count, until, byDay };
}

type LocalParts = { year:number; month:number; day:number; hour:number; minute:number; second:number };

function localParts(date: Date, timeZone: string): LocalParts {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit", hourCycle:"h23",
    }).formatToParts(date);
  } catch {
    throw new AppError(422, "MEETING_TIMEZONE_INVALID", "Invalid meeting timezone");
  }
  const get=(type:Intl.DateTimeFormatPartTypes)=>Number(parts.find(x=>x.type===type)?.value);
  return { year:get("year"),month:get("month"),day:get("day"),hour:get("hour"),minute:get("minute"),second:get("second") };
}

function sameParts(a:LocalParts,b:LocalParts){return a.year===b.year&&a.month===b.month&&a.day===b.day&&a.hour===b.hour&&a.minute===b.minute&&a.second===b.second}

function localToUtc(target: LocalParts, timeZone: string) {
  let guess = Date.UTC(target.year,target.month-1,target.day,target.hour,target.minute,target.second);
  for (let attempt=0; attempt<5; attempt++) {
    const actual=localParts(new Date(guess),timeZone);
    const wantedUtc=Date.UTC(target.year,target.month-1,target.day,target.hour,target.minute,target.second);
    const actualAsUtc=Date.UTC(actual.year,actual.month-1,actual.day,actual.hour,actual.minute,actual.second);
    const delta=wantedUtc-actualAsUtc;
    if(delta===0) break;
    guess += delta;
  }
  const result=new Date(guess);
  if(!sameParts(localParts(result,timeZone),target)) throw new AppError(422,"MEETING_RECURRENCE_DST_GAP","A recurring meeting occurrence falls in a daylight-saving time gap");
  return result;
}

function addLocalDays(base: LocalParts, days: number): LocalParts {
  const d=new Date(Date.UTC(base.year,base.month-1,base.day+days,base.hour,base.minute,base.second));
  return {year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate(),hour:d.getUTCHours(),minute:d.getUTCMinutes(),second:d.getUTCSeconds()};
}
function addLocalMonths(base: LocalParts, months: number): LocalParts {
  const first=new Date(Date.UTC(base.year,base.month-1+months,1,base.hour,base.minute,base.second));
  const lastDay=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
  return {year:first.getUTCFullYear(),month:first.getUTCMonth()+1,day:Math.min(base.day,lastDay),hour:base.hour,minute:base.minute,second:base.second};
}
function localDayOfWeek(p: LocalParts){ return new Date(Date.UTC(p.year,p.month-1,p.day)).getUTCDay(); }
function localDateSerial(p:LocalParts){return Math.floor(Date.UTC(p.year,p.month-1,p.day)/86400000)}

export function generateMeetingOccurrences(input: {
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  rule: string;
  horizon?: Date;
  maxOccurrences?: number;
}) {
  if (input.endsAt <= input.startsAt) throw new AppError(422,"MEETING_TIME_INVALID","Meeting end time must follow start time");
  const parsed=parseMeetingRecurrenceRule(input.rule);
  const startLocal=localParts(input.startsAt,input.timezone);
  const durationMs=input.endsAt.getTime()-input.startsAt.getTime();
  const horizon=input.horizon ?? new Date(input.startsAt.getTime()+366*86400000);
  const hardMax=Math.min(input.maxOccurrences??366,366);
  const limit=Math.min(parsed.count??hardMax,hardMax);
  const out:{startsAt:Date;endsAt:Date;occurrenceIndex:number}[]=[];

  const accept=(p:LocalParts)=>{
    const start=localToUtc(p,input.timezone);
    if(start < input.startsAt || start > horizon || parsed.until && start > parsed.until) return false;
    out.push({startsAt:start,endsAt:new Date(start.getTime()+durationMs),occurrenceIndex:out.length+1});
    return out.length < limit;
  };

  if(parsed.freq==="DAILY"){
    for(let n=0; out.length<limit; n++){
      const p=addLocalDays(startLocal,n*parsed.interval);
      const instant=localToUtc(p,input.timezone);
      if(instant>horizon || parsed.until&&instant>parsed.until) break;
      if(!accept(p)) break;
    }
  } else if(parsed.freq==="MONTHLY"){
    for(let n=0; out.length<limit; n++){
      const p=addLocalMonths(startLocal,n*parsed.interval);
      const instant=localToUtc(p,input.timezone);
      if(instant>horizon || parsed.until&&instant>parsed.until) break;
      if(!accept(p)) break;
    }
  } else {
    const selected=(parsed.byDay?.length?parsed.byDay.map(x=>dayIndex[x]):[localDayOfWeek(startLocal)]).sort((a,b)=>a-b);
    for(let dayOffset=0; out.length<limit; dayOffset++){
      const p=addLocalDays(startLocal,dayOffset);
      const instant=localToUtc(p,input.timezone);
      if(instant>horizon || parsed.until&&instant>parsed.until) break;
      const startWeekSerial=localDateSerial(startLocal)-((localDayOfWeek(startLocal)+6)%7);
      const weekOffset=Math.floor((localDateSerial(p)-startWeekSerial)/7);
      if(weekOffset<0 || weekOffset%parsed.interval!==0 || !selected.includes(localDayOfWeek(p))) continue;
      if(!accept(p)) break;
    }
  }
  if(!out.length) throw new AppError(422,"MEETING_RECURRENCE_EMPTY","Recurrence rule produced no meeting occurrences");
  return out;
}
