import { Prisma } from "@prisma/client";
import { env } from "../config.js";
import { AppError } from "./http.js";
import { systemPrisma } from "./prisma.js";
import { calculateSchoolOSVideoRoomMinutes,verifySchoolOSLiveKitWebhook } from "./schoolos-livekit-evidence-policy.js";

export function isSchoolOSVideoEvidenceEnabled(organizationId:string,allowlist:string|undefined|null) {
 if(!organizationId || organizationId==="org_default" || !allowlist)return false;
 return allowlist.split(",").map(x=>x.trim()).some(x=>x===organizationId);
}

/** Provider-authenticated, replay-safe event ingestion. No video credit is debited. */
export async function ingestSchoolOSLiveKitEvidence(raw:Buffer,authorization:string|undefined) {
 if(!env.SCHOOLOS_VIDEO_WEBHOOK_ENABLED)
  throw new AppError(404,"SCHOOLOS_VIDEO_WEBHOOK_DISABLED","LiveKit video evidence is not enabled");
 const event=verifySchoolOSLiveKitWebhook(raw,authorization,env.LIVEKIT_API_KEY,env.LIVEKIT_API_SECRET);
 if(!event)return {status:"IGNORED" as const,eventId:null};
 const meetings=await systemPrisma.meeting.findMany({
  where:{livekitRoomName:event.roomName},
  select:{id:true,organizationId:true},take:2,
 });
 if(meetings.length!==1)
  throw new AppError(409,"SCHOOLOS_LIVEKIT_ROOM_AMBIGUOUS","Provider room is not uniquely mapped to an institution");
 const meeting=meetings[0]!;
 if(!isSchoolOSVideoEvidenceEnabled(meeting.organizationId,env.SCHOOLOS_VIDEO_EVIDENCE_TENANT_IDS))
  throw new AppError(409,"SCHOOLOS_VIDEO_TENANT_DISABLED","This institution has not enabled video evidence");
 if(event.identity) {
  const invited=await systemPrisma.meetingParticipant.findFirst({
   where:{organizationId:meeting.organizationId,meetingId:meeting.id,userId:event.identity},
   select:{id:true},
  });
  if(!invited)throw new AppError(422,"SCHOOLOS_LIVEKIT_PARTICIPANT_INVALID","Participant not assigned to this institution meeting");
 }
 const same=async()=>{
  const prior=await systemPrisma.schoolOSLiveKitEvent.findUnique({
   where:{providerEventId:event.eventId},
   select:{id:true,rawSha256:true,meetingId:true,eventType:true},
  });
  if(!prior)return null;
  if(prior.rawSha256!==event.bodySha256 || prior.meetingId!==meeting.id ||
   prior.eventType!==event.eventType)
   throw new AppError(409,"SCHOOLOS_LIVEKIT_EVENT_REPLAY_CONFLICT","LiveKit event ID reused with different signed evidence");
  return {status:"REPLAY" as const,eventId:event.eventId};
 };
 const prior=await same();
 if(prior)return prior;
 try {
  await systemPrisma.schoolOSLiveKitEvent.create({data:{
   providerEventId:event.eventId,organizationId:meeting.organizationId,meetingId:meeting.id,
   eventType:event.eventType,identity:event.identity,participantSid:event.participantSid,
   occurredAt:event.occurredAt,rawSha256:event.bodySha256,
  }});
 }catch(error) {
  if(error instanceof Prisma.PrismaClientKnownRequestError && error.code==="P2002"){
   const retry=await same();if(retry)return retry;
  }
  throw error;
 }
 return {status:"STORED" as const,eventId:event.eventId};
}

/** Preview explicitly excludes self-declared join/leave attendance from billing evidence. */
export async function schoolOSVideoEvidencePreview(organizationId:string,meetingId:string){
 if(!organizationId || organizationId==="org_default")
  throw new AppError(422,"SCHOOLOS_VIDEO_TENANT_REQUIRED","Customer institution required");
 const meeting=await systemPrisma.meeting.findFirst({
  where:{id:meetingId,organizationId},
  select:{id:true,organizationId:true,hostUserId:true,livekitRoomName:true,status:true},
 });
 if(!meeting)throw new AppError(404,"SCHOOLOS_VIDEO_MEETING_NOT_FOUND","Meeting not found in this institution");
 const events=await systemPrisma.schoolOSLiveKitEvent.findMany({
  where:{organizationId,meetingId},orderBy:[{occurredAt:"asc"},{id:"asc"}],take:10001,
  select:{eventType:true,identity:true,participantSid:true,occurredAt:true},
 });
 const result=calculateSchoolOSVideoRoomMinutes(events,meeting.hostUserId);
 return {organizationId,meetingId,roomName:meeting.livekitRoomName,meetingStatus:meeting.status,
  signedProviderEvents:events.length,providerEvidenceConfigured:
   env.SCHOOLOS_VIDEO_WEBHOOK_ENABLED &&
   isSchoolOSVideoEvidenceEnabled(organizationId,env.SCHOOLOS_VIDEO_EVIDENCE_TENANT_IDS),
  ...result,meteringConnected:false,automaticBillingEnabled:false,
  attendanceIsNotBillingEvidence:true,pricingPolicy:"PENDING_FINANCE_APPROVAL"};
}
