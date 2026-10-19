import { MeetingStatus, Prisma } from "@prisma/client";
import { env } from "../config.js";
import { AppError } from "./http.js";
import { systemPrisma } from "./prisma.js";
import { isSchoolOSVideoEvidenceEnabled } from "./schoolos-livekit-evidence-service.js";
import { schoolOSVideoEvidenceSnapshot } from "./schoolos-video-settlement-policy.js";
import { assertSchoolOSUsageRequest } from "./schoolos-usage-policy.js";

type Tx=Prisma.TransactionClient;
const metric="video_minutes";
const invoiceEvidence="VIDEO_ROOM_MINUTES_V1";

function requireCustomer(organizationId:string) {
 if(!organizationId || organizationId==="org_default")
  throw new AppError(403,"SCHOOLOS_VIDEO_TENANT_REQUIRED","Customer institution required");
}
function requireApproval(organizationId:string) {
 if(!env.SCHOOLOS_VIDEO_SETTLEMENT_ENABLED ||
  !isSchoolOSVideoEvidenceEnabled(organizationId,env.SCHOOLOS_VIDEO_SETTLEMENT_TENANT_IDS) ||
  !env.SCHOOLOS_VIDEO_WEBHOOK_ENABLED ||
  !isSchoolOSVideoEvidenceEnabled(organizationId,env.SCHOOLOS_VIDEO_EVIDENCE_TENANT_IDS))
  throw new AppError(409,"SCHOOLOS_VIDEO_SETTLEMENT_DISABLED",
   "Separate customer-specific finance approval and signed provider evidence are required");
}
function validReference(reference:string,rationale:string) {
 if(typeof reference!=="string" || reference.trim().length<12 || reference.trim().length>250 ||
    typeof rationale!=="string" || rationale.trim().length<20 || rationale.trim().length>2000)
  throw new AppError(422,"SCHOOLOS_VIDEO_REVIEW_EVIDENCE_REQUIRED","Evidence reference and detailed rationale required");
}
async function lock(tx:Tx,organizationId:string,meetingId:string) {
 // Serialize provider event ingestion and financial approval on the same room.
 await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext(${"schoolos-video:"+meetingId}))`;
 await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext(${"schoolos-usage:"+organizationId+":"+metric}))`;
}
async function snapshot(tx:Tx,organizationId:string,meetingId:string) {
 const meeting=await tx.meeting.findFirst({
  where:{id:meetingId,organizationId},
  select:{id:true,hostUserId:true,status:true},
 });
 if(!meeting)throw new AppError(404,"SCHOOLOS_VIDEO_MEETING_NOT_FOUND","Tenant meeting not found");
 const events=await tx.schoolOSLiveKitEvent.findMany({
  where:{organizationId,meetingId},orderBy:[{occurredAt:"asc"},{id:"asc"}],take:10001,
  select:{providerEventId:true,eventType:true,identity:true,participantSid:true,occurredAt:true,rawSha256:true},
 });
 const proof=schoolOSVideoEvidenceSnapshot(events,meeting.hostUserId,meeting.status);
 return {meeting,proof};
}

/** Makes no debit: maker attests to a frozen signed-evidence snapshot. */
export async function proposeSchoolOSVideoReview(
 organizationId:string,meetingId:string,proposedBy:string,evidenceReference:string,rationale:string,
) {
 requireCustomer(organizationId);
 validReference(evidenceReference,rationale);
 if(!proposedBy)throw new AppError(403,"SCHOOLOS_VIDEO_REVIEWER_REQUIRED","Authenticated reviewer required");
 return systemPrisma.$transaction(async tx=>{
  await lock(tx,organizationId,meetingId);
  const {meeting,proof}=await snapshot(tx,organizationId,meetingId);
  if(meeting.hostUserId===proposedBy)
   throw new AppError(403,"SCHOOLOS_VIDEO_HOST_CANNOT_REVIEW","Meeting host cannot approve own video usage");
  const existing=await tx.schoolOSVideoUsageReview.findUnique({where:{meetingId}});
  if(existing)throw new AppError(409,"SCHOOLOS_VIDEO_REVIEW_ALREADY_EXISTS","Meeting already has a reviewed or pending finance decision");
  const row=await tx.schoolOSVideoUsageReview.create({data:{
   organizationId,meetingId,status:"PENDING",evidenceSha256:proof.evidenceSha256,
   eventCount:proof.eventCount,proposedMinutes:proof.minutes,
   firstEventAt:proof.firstEventAt,lastEventAt:proof.lastEventAt,
   proposedBy,evidenceReference:evidenceReference.trim(),rationale:rationale.trim(),
  }});
  await tx.auditLog.create({data:{organizationId,actorId:proposedBy,
   action:"SCHOOLOS_VIDEO_USAGE_REVIEW_PROPOSED",entity:"SchoolOSVideoUsageReview",
   entityId:row.id,metadata:{meetingId,minutes:row.proposedMinutes,
     evidenceSha256:row.evidenceSha256,policy:invoiceEvidence}}});
  return {id:row.id,status:row.status,minutes:row.proposedMinutes,
   evidenceSha256:row.evidenceSha256,automaticCharge:false};
 });
}

/** Read-only review access is independent of billing activation. */
export async function listSchoolOSVideoReviews(organizationId:string) {
 requireCustomer(organizationId);
 return systemPrisma.schoolOSVideoUsageReview.findMany({
  where:{organizationId},orderBy:{proposedAt:"desc"},take:100,
  select:{id:true,meetingId:true,status:true,evidenceSha256:true,eventCount:true,
   proposedMinutes:true,firstEventAt:true,lastEventAt:true,proposedAt:true,proposedBy:true,
   reviewedBy:true,reviewedAt:true},
 });
}
