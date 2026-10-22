import crypto from "node:crypto";
import { MeetingStatus } from "@prisma/client";
import { AppError } from "./http.js";
import { calculateSchoolOSVideoRoomMinutes } from "./schoolos-livekit-evidence-policy.js";

/** Signed provider evidence digest makes a quote of used minutes tamper-evident. */
export type StoredVideoEvent = {
 providerEventId:string;eventType:string;identity:string|null;participantSid:string|null;
 occurredAt:Date;rawSha256:string;
};
export function schoolOSVideoEvidenceSnapshot(
 events:StoredVideoEvent[],hostIdentity:string,meetingStatus:MeetingStatus,
 allowZero=false,
) {
 if(!new Set<MeetingStatus>([MeetingStatus.ENDED,MeetingStatus.CLOSED,MeetingStatus.MINUTES_PENDING,
   MeetingStatus.MINUTES_PUBLISHED]).has(meetingStatus))
  throw new AppError(409,"SCHOOLOS_VIDEO_ROOM_NOT_CLOSED","Only ended meetings are eligible for finance review");
 if(events.length<3 || events.length>10000)
  throw new AppError(409,"SCHOOLOS_VIDEO_PROOF_COUNT_INVALID","Complete signed room evidence is required");
 const sorted=[...events].sort((a,b)=>a.occurredAt.getTime()-b.occurredAt.getTime()||
    a.providerEventId.localeCompare(b.providerEventId));
 if(new Set(sorted.map(e=>e.providerEventId)).size!==sorted.length)
  throw new AppError(409,"SCHOOLOS_VIDEO_PROOF_REPLAY","Provider event IDs must be unique");
 const preview=calculateSchoolOSVideoRoomMinutes(sorted,hostIdentity);
 if(preview.status!=="PREVIEW_ONLY" || preview.minutes===null || preview.seconds===null ||
   (preview.minutes===0 && !allowZero) || preview.minutes>100000)
  throw new AppError(409,"SCHOOLOS_VIDEO_USAGE_UNVERIFIED","Provider session is not sufficiently verified for billable review");
 if(allowZero && preview.minutes!==0)
  throw new AppError(409,"SCHOOLOS_VIDEO_HAS_BILLABLE_USAGE",
   "Provider-confirmed billable overlap must use normal video usage settlement");
 if(preview.minutes===0) {
  // Conservative proof set: exactly one host-only provider join, its matching
  // departure and a signed terminal room event; no unknown reconnects.
  if(!allowZero || sorted.length!==3 ||
    sorted[0]!.eventType!=="participant_joined" || sorted[0]!.identity!==hostIdentity ||
    sorted[1]!.eventType!=="participant_left" || sorted[1]!.identity!==hostIdentity ||
    sorted[0]!.participantSid!==sorted[1]!.participantSid ||
    sorted[2]!.eventType!=="room_finished")
   throw new AppError(409,"SCHOOLOS_VIDEO_ZERO_USE_PROOF_INCOMPLETE",
    "Only a fully closed single-host provider session can request zero-usage release");
 }
 const firstEventAt=sorted[0]!.occurredAt,lastEventAt=sorted[sorted.length-1]!.occurredAt;
 if(lastEventAt.getTime()<=firstEventAt.getTime())
  throw new AppError(409,"SCHOOLOS_VIDEO_EVENT_WINDOW_INVALID","Provider session window must be positive");
 const evidenceSha256=crypto.createHash("sha256").update(JSON.stringify({
  policy:"VIDEO_ROOM_MINUTES_V1",hostIdentity,
  events:sorted.map(e=>[e.providerEventId,e.eventType,e.identity,e.participantSid,
   e.occurredAt.toISOString(),e.rawSha256]),
 })).digest("hex");
 return {evidenceSha256,eventCount:events.length,minutes:preview.minutes,
  seconds:preview.seconds,firstEventAt,lastEventAt};
}
