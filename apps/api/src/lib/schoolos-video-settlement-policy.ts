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
) {
 if(![MeetingStatus.ENDED,MeetingStatus.CLOSED,MeetingStatus.MINUTES_PENDING,
   MeetingStatus.MINUTES_PUBLISHED].includes(meetingStatus))
  throw new AppError(409,"SCHOOLOS_VIDEO_ROOM_NOT_CLOSED","Only ended meetings are eligible for finance review");
 if(events.length<3 || events.length>10000)
  throw new AppError(409,"SCHOOLOS_VIDEO_PROOF_COUNT_INVALID","Complete signed room evidence is required");
 const sorted=[...events].sort((a,b)=>a.occurredAt.getTime()-b.occurredAt.getTime()||
    a.providerEventId.localeCompare(b.providerEventId));
 if(new Set(sorted.map(e=>e.providerEventId)).size!==sorted.length)
  throw new AppError(409,"SCHOOLOS_VIDEO_PROOF_REPLAY","Provider event IDs must be unique");
 const preview=calculateSchoolOSVideoRoomMinutes(sorted,hostIdentity);
 if(preview.status!=="PREVIEW_ONLY" || preview.minutes===null || preview.seconds===null ||
   preview.minutes<1 || preview.minutes>100000)
  throw new AppError(409,"SCHOOLOS_VIDEO_USAGE_UNVERIFIED","Provider session is not sufficiently verified for billable review");
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
