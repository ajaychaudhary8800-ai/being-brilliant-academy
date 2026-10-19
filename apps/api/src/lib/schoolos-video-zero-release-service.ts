import { Prisma } from "@prisma/client";
import { env } from "../config.js";
import { AppError } from "./http.js";
import { systemPrisma } from "./prisma.js";
import { isSchoolOSVideoEvidenceEnabled } from "./schoolos-livekit-evidence-service.js";
import { schoolOSVideoAdmissionEnabled,schoolOSVideoReservationKey } from "./schoolos-video-admission.js";
import { schoolOSVideoEvidenceSnapshot } from "./schoolos-video-settlement-policy.js";
import { livekitConfigured,livekitRoomService } from "./livekit.js";

const metric="video_minutes";
const minimumProviderQuiescenceMs=72*60*60*1000;
type Tx=Prisma.TransactionClient;
function releaseEnabled(organizationId:string){
 return env.SCHOOLOS_VIDEO_ZERO_RELEASE_ENABLED &&
   isSchoolOSVideoEvidenceEnabled(organizationId,env.SCHOOLOS_VIDEO_ZERO_RELEASE_TENANT_IDS) &&
   schoolOSVideoAdmissionEnabled(organizationId);
}
function requireRelease(organizationId:string){
 if(!releaseEnabled(organizationId))
  throw new AppError(409,"SCHOOLOS_VIDEO_RELEASE_DISABLED",
   "Provider-confirmed zero-use credit release is disabled for this institution");
}
function validateRationale(evidenceReference:string,rationale:string){
 if(typeof evidenceReference!=="string" || evidenceReference.trim().length<12 ||
  evidenceReference.trim().length>250 || typeof rationale!=="string" ||
  rationale.trim().length<20 || rationale.trim().length>2000)
   throw new AppError(422,"SCHOOLOS_VIDEO_RELEASE_EVIDENCE_REQUIRED",
    "A provider outcome reference and independent detailed justification are required");
}
async function lock(tx:Tx,organizationId:string,meetingId:string){
 await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext(${"schoolos-video:"+meetingId}))`;
 await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext(${"schoolos-usage:"+organizationId+":"+metric}))`;
}
async function verifiedZeroProof(tx:Tx,organizationId:string,meetingId:string,now:Date){
 const meeting=await tx.meeting.findFirst({
  where:{organizationId,id:meetingId},
  select:{id:true,hostUserId:true,endsAt:true,status:true,livekitRoomName:true},
 });
 if(!meeting)throw new AppError(404,"SCHOOLOS_VIDEO_MEETING_NOT_FOUND","Tenant meeting not found");
 const events=await tx.schoolOSLiveKitEvent.findMany({
  where:{organizationId,meetingId},take:10001,orderBy:[{occurredAt:"asc"},{id:"asc"}],
  select:{providerEventId:true,eventType:true,identity:true,participantSid:true,
   occurredAt:true,rawSha256:true},
 });
 const proof=schoolOSVideoEvidenceSnapshot(events,meeting.hostUserId,meeting.status,true);
 if(proof.minutes!==0 || proof.seconds!==0)
  throw new AppError(409,"SCHOOLOS_VIDEO_HAS_BILLABLE_USAGE",
   "Provider evidence indicates possible billable participant overlap");
 if(now.getTime() - Math.max(proof.lastEventAt.getTime(),meeting.endsAt.getTime()) <
     minimumProviderQuiescenceMs)
  throw new AppError(409,"SCHOOLOS_VIDEO_RELEASE_COOLING_OFF",
   "At least 72 hours after provider room completion are required for delayed webhook review");
 const reservation=await tx.schoolOSUsageReservation.findUnique({
  where:{organizationId_metric_requestKey:{
   organizationId,metric,requestKey:schoolOSVideoReservationKey(meetingId),
  }},
 });
 if(!reservation || reservation.status!=="RESERVED")
  throw new AppError(409,"SCHOOLOS_VIDEO_RELEASE_NO_HOLD",
   "Only an existing unreconciled prepaid video hold can be released");
 const usage=await tx.schoolOSUsageEvent.findUnique({
  where:{organizationId_metric_requestKey:{
   organizationId,metric,requestKey:schoolOSVideoReservationKey(meetingId),
  }},select:{id:true},
 });
 if(usage)throw new AppError(409,"SCHOOLOS_VIDEO_ALREADY_SETTLED",
  "An already billed session cannot release its original prepaid hold");
 return {meeting,proof,reservation};
}
function assertSameEvidence(row:{
 evidenceSha256:string;eventCount:number;proposedMinutes:number;
 firstEventAt:Date;lastEventAt:Date;
},proof:{
 evidenceSha256:string;eventCount:number;minutes:number;
 firstEventAt:Date;lastEventAt:Date;
}){
 if(row.proposedMinutes!==0 || proof.minutes!==0 ||
  row.evidenceSha256!==proof.evidenceSha256 || row.eventCount!==proof.eventCount ||
  row.firstEventAt.getTime()!==proof.firstEventAt.getTime() ||
  row.lastEventAt.getTime()!==proof.lastEventAt.getTime())
  throw new AppError(409,"SCHOOLOS_VIDEO_RELEASE_EVIDENCE_CHANGED",
   "Financial release evidence no longer matches the signed provider record");
}
/** Operator's proposal cannot touch prepaid credits. */
export async function proposeSchoolOSZeroVideoRelease(
 organizationId:string,meetingId:string,makerId:string,
 evidenceReference:string,rationale:string,now=new Date(),
){
 requireRelease(organizationId);validateRationale(evidenceReference,rationale);
 if(!makerId)throw new AppError(403,"SCHOOLOS_VIDEO_REVIEWER_REQUIRED","Maker identity required");
 return systemPrisma.$transaction(async tx=>{
  await lock(tx,organizationId,meetingId);
  const {meeting,proof}=await verifiedZeroProof(tx,organizationId,meetingId,now);
  if(makerId===meeting.hostUserId)
   throw new AppError(403,"SCHOOLOS_VIDEO_HOST_CANNOT_RELEASE","Meeting host cannot review own credit release");
  const existing=await tx.schoolOSVideoUsageReview.findUnique({where:{meetingId}});
  if(existing)throw new AppError(409,"SCHOOLOS_VIDEO_REVIEW_ALREADY_EXISTS",
   "This meeting already has a pending or final financial decision");
  const row=await tx.schoolOSVideoUsageReview.create({data:{
   organizationId,meetingId,status:"PENDING",evidenceSha256:proof.evidenceSha256,
   eventCount:proof.eventCount,proposedMinutes:0,
   firstEventAt:proof.firstEventAt,lastEventAt:proof.lastEventAt,
   evidenceReference:evidenceReference.trim(),rationale:rationale.trim(),proposedBy:makerId,
  }});
  await tx.auditLog.create({data:{organizationId,actorId:makerId,
   action:"SCHOOLOS_VIDEO_ZERO_RELEASE_PROPOSED",entity:"SchoolOSVideoUsageReview",
   entityId:row.id,metadata:{meetingId,providerReference:row.evidenceReference,
    proofSha256:proof.evidenceSha256,reason:row.rationale}}});
  return {id:row.id,status:"PENDING" as const,minutes:0,
   evidenceSha256:proof.evidenceSha256,automaticRelease:false};
 });
}
/**
 * A second independent platform finance operator must confirm LiveKit
 * no longer has an active named room. Provider unavailability = no release.
 */
export async function decideSchoolOSZeroVideoRelease(
 organizationId:string,reviewId:string,checkerId:string,
 decision:"APPROVE"|"REJECT",comment:string,now=new Date(),
){
 requireRelease(organizationId);
 if(!checkerId || !["APPROVE","REJECT"].includes(decision) ||
  typeof comment!=="string" || comment.trim().length<20||comment.trim().length>2000)
   throw new AppError(422,"SCHOOLOS_VIDEO_RELEASE_DECISION_INVALID",
    "An independent checker and detailed reason are required");
 const pending=await systemPrisma.schoolOSVideoUsageReview.findFirst({
  where:{id:reviewId,organizationId,status:"PENDING",proposedMinutes:0},
  select:{meetingId:true,proposedBy:true},
 });
 if(!pending)throw new AppError(404,"SCHOOLOS_VIDEO_RELEASE_REVIEW_NOT_FOUND",
  "Pending zero-use finance review not found");
 if(pending.proposedBy===checkerId)
  throw new AppError(403,"SCHOOLOS_VIDEO_MAKER_CHECKER_REQUIRED",
   "The release checker must be different from its proposer");
 if(decision==="APPROVE"){
  if(!livekitConfigured())
   throw new AppError(503,"SCHOOLOS_VIDEO_PROVIDER_UNAVAILABLE",
    "A live provider room-state check is mandatory before prepaid release");
  const meeting=await systemPrisma.meeting.findFirst({where:{
   id:pending.meetingId,organizationId},select:{livekitRoomName:true},
  });
  if(!meeting)throw new AppError(404,"SCHOOLOS_VIDEO_MEETING_NOT_FOUND","Missing meeting");
  const state=await livekitRoomService("ListRooms",
   {names:[meeting.livekitRoomName]},meeting.livekitRoomName);
  if(!state || !Array.isArray(state.rooms))
   throw new AppError(503,"SCHOOLOS_VIDEO_PROVIDER_STATE_AMBIGUOUS",
    "The provider has not returned authoritative current room state");
  if(state.rooms.some((r:{name?:unknown})=>r?.name===meeting.livekitRoomName))
   throw new AppError(409,"SCHOOLOS_VIDEO_PROVIDER_ROOM_ACTIVE",
    "The LiveKit room still exists; the reserved minutes cannot be released");
 }
 return systemPrisma.$transaction(async tx=>{
  await lock(tx,organizationId,pending.meetingId);
  const row=await tx.schoolOSVideoUsageReview.findFirst({
   where:{id:reviewId,organizationId,status:"PENDING",proposedMinutes:0},
  });
  if(!row)throw new AppError(409,"SCHOOLOS_VIDEO_RELEASE_FINAL","Review already finalized");
  const {meeting,proof,reservation}=await verifiedZeroProof(tx,organizationId,pending.meetingId,now);
  if(row.proposedBy===checkerId || checkerId===meeting.hostUserId)
   throw new AppError(403,"SCHOOLOS_VIDEO_REVIEWER_CONFLICT",
    "Host and proposer are not eligible to approve this release");
  assertSameEvidence(row,proof);
  if(decision==="REJECT"){
   await tx.schoolOSVideoUsageReview.update({
    where:{id:row.id},data:{status:"REJECTED",reviewedBy:checkerId,
      reviewedAt:now,reviewComment:comment.trim()},
   });
   await tx.auditLog.create({data:{organizationId,actorId:checkerId,
    action:"SCHOOLOS_VIDEO_ZERO_RELEASE_REJECTED",entity:"SchoolOSVideoUsageReview",
    entityId:row.id,metadata:{meetingId:row.meetingId,reason:comment.trim()}}});
   return {status:"REJECTED" as const,releasedMinutes:0};
  }
  const hold=await tx.schoolOSPaymentRiskHold.findFirst({
   where:{organizationId,status:"ACTIVE"},select:{id:true},
  });
  if(hold)throw new AppError(409,"SCHOOLOS_VIDEO_RELEASE_FINANCE_HOLD",
   "Provider payment dispute or refund risk requires finance resolution");
  const updated=await tx.schoolOSUsageBalance.updateMany({
   where:{id:reservation.balanceId,organizationId,metric,
    consumedUnits:{gte:reservation.units}},
   data:{consumedUnits:{decrement:reservation.units}},
  });
  if(updated.count!==1)throw new AppError(409,"SCHOOLOS_VIDEO_HELD_BALANCE_INCONSISTENT",
   "Held prepaid minutes could not be verified");
  await tx.schoolOSUsageReservation.update({where:{id:reservation.id},
   data:{status:"RELEASED",releasedAt:now,releaseReason:"Verified zero-use provider outcome; "+comment.trim()},
  });
  await tx.schoolOSVideoUsageReview.update({where:{id:row.id},
   data:{status:"RELEASED",reviewedBy:checkerId,reviewedAt:now,reviewComment:comment.trim()},
  });
  await tx.auditLog.create({data:{organizationId,actorId:checkerId,
   action:"SCHOOLOS_VIDEO_ZERO_RELEASE_APPROVED",entity:"SchoolOSUsageReservation",
   entityId:reservation.id,metadata:{meetingId:row.meetingId,minutes:reservation.units,
    evidenceSha256:row.evidenceSha256,providerReference:row.evidenceReference,
    makerId:row.proposedBy,checkerId,reviewComment:comment.trim(),
    providerRoomConfirmedAbsent:true,policy:"VIDEO_ROOM_MINUTES_V1"}}});
  return {status:"RELEASED" as const,releasedMinutes:reservation.units};
 },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
}
