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

/**
 * An independent checker may settle a completed room from prepaid minutes.
 * All proof, paid-credit, eligibility, quota and ledger writes are checked in
 * one transaction. No payment provider operation is ever initiated here.
 */
export async function decideSchoolOSVideoReview(
 organizationId:string,reviewId:string,reviewedBy:string,
 decision:"APPROVE"|"REJECT",reviewComment:string,now=new Date(),
) {
 requireCustomer(organizationId);
 if(!reviewedBy || !["APPROVE","REJECT"].includes(decision) ||
    typeof reviewComment!=="string" || reviewComment.trim().length<20 ||
    reviewComment.trim().length>2000)
  throw new AppError(422,"SCHOOLOS_VIDEO_DECISION_INVALID","Independent reviewer and justification required");
 return systemPrisma.$transaction(async tx=>{
  const read=await tx.schoolOSVideoUsageReview.findFirst({
   where:{id:reviewId,organizationId},select:{meetingId:true},
  });
  if(!read)throw new AppError(404,"SCHOOLOS_VIDEO_REVIEW_NOT_FOUND","Video finance review not found");
  await lock(tx,organizationId,read.meetingId);
  const row=await tx.schoolOSVideoUsageReview.findFirst({
   where:{id:reviewId,organizationId},
  });
  if(!row)throw new AppError(404,"SCHOOLOS_VIDEO_REVIEW_NOT_FOUND","Review not found");
  if(row.status!=="PENDING")
   throw new AppError(409,"SCHOOLOS_VIDEO_REVIEW_FINAL","Video review already finalized");
  if(row.proposedBy===reviewedBy)
   throw new AppError(403,"SCHOOLOS_VIDEO_MAKER_CHECKER_REQUIRED","Proposal and approval must be performed by different administrators");
  const {meeting,proof}=await snapshot(tx,organizationId,row.meetingId);
  if(meeting.hostUserId===reviewedBy)
   throw new AppError(403,"SCHOOLOS_VIDEO_HOST_CANNOT_APPROVE","Meeting host cannot approve self usage");
  if(row.evidenceSha256!==proof.evidenceSha256 || row.eventCount!==proof.eventCount ||
     row.proposedMinutes!==proof.minutes ||
     row.firstEventAt.getTime()!==proof.firstEventAt.getTime() ||
     row.lastEventAt.getTime()!==proof.lastEventAt.getTime())
   throw new AppError(409,"SCHOOLOS_VIDEO_EVIDENCE_CHANGED",
    "Provider evidence changed after proposal; reconciliation required");
  if(decision==="REJECT"){
   const rejected=await tx.schoolOSVideoUsageReview.update({
    where:{id:row.id},data:{status:"REJECTED",reviewedBy,
     reviewedAt:now,reviewComment:reviewComment.trim()},
   });
   await tx.auditLog.create({data:{organizationId,actorId:reviewedBy,
    action:"SCHOOLOS_VIDEO_USAGE_REVIEW_REJECTED",entity:"SchoolOSVideoUsageReview",
    entityId:row.id,metadata:{meetingId:row.meetingId,reviewComment:reviewComment.trim()}}});
   return {status:rejected.status,charged:false,minutes:row.proposedMinutes};
  }
  requireApproval(organizationId);
  const organization=await tx.organization.findUnique({where:{id:organizationId},
   select:{isActive:true,deletedAt:true,subscriptionStatus:true,subscriptionEndsAt:true}});
  if(!organization || !organization.isActive || organization.deletedAt ||
     organization.subscriptionStatus!=="ACTIVE" || !organization.subscriptionEndsAt ||
     organization.subscriptionEndsAt<=now)
   throw new AppError(403,"SCHOOLOS_VIDEO_SUBSCRIPTION_INACTIVE","Verified active paid subscription required");
  const hold=await tx.schoolOSPaymentRiskHold.findFirst({
   where:{organizationId,status:"ACTIVE"},select:{id:true},
  });
  if(hold)throw new AppError(409,"SCHOOLOS_VIDEO_PAYMENT_RISK_HOLD",
   "Financial risk hold prohibits settling video minutes");
  const key="video-meeting:"+row.meetingId;
  assertSchoolOSUsageRequest({metric,units:row.proposedMinutes,requestKey:key});
  const existing=await tx.schoolOSUsageEvent.findUnique({
   where:{organizationId_metric_requestKey:{organizationId,metric,requestKey:key}},
  });
  if(existing)throw new AppError(409,"SCHOOLOS_VIDEO_ALREADY_SETTLED",
   "Meeting usage already has a financial ledger event");
  const buckets=await tx.schoolOSUsageBalance.findMany({where:{
   organizationId,metric,periodStart:{lte:row.firstEventAt},
   periodEnd:{gt:row.lastEventAt},
  }});
  if(buckets.length!==1 || buckets[0]!.periodEnd<=now)
   throw new AppError(409,"SCHOOLOS_VIDEO_BILLING_PERIOD_INVALID",
    "A single current prepaid period must cover the complete room session");
  const bucket=buckets[0]!;
  const paidGrant=await tx.schoolOSUsageEvent.findFirst({where:{
   organizationId,balanceId:bucket.id,metric,kind:"GRANT",
   sourceInvoice:{is:{
    organizationId,status:"PAID",paidAt:{not:null},
    providerOrderId:{not:null},schoolOSQuoteId:{not:null},
    schoolOSQuote:{is:{organizationId,status:"PAID",contractDocumentId:{not:null}}},
    payments:{some:{status:"CAPTURED",providerPaymentId:{not:null}}},
    OR:[{schoolOSPaymentRiskHold:{is:null}},{schoolOSPaymentRiskHold:{is:{status:"RESOLVED"}}}],
   }},
  },select:{id:true}});
  if(!paidGrant)
   throw new AppError(409,"SCHOOLOS_VIDEO_PAID_GRANT_REQUIRED",
    "Valid provider-paid signed-contract video credit grant is missing");
  const updated=await tx.schoolOSUsageBalance.updateMany({
   where:{id:bucket.id,organizationId,metric,
    consumedUnits:{lte:bucket.grantedUnits-row.proposedMinutes}},
   data:{consumedUnits:{increment:row.proposedMinutes}},
  });
  if(updated.count!==1)
   throw new AppError(402,"SCHOOLOS_VIDEO_MINUTES_EXHAUSTED",
    "Insufficient prepaid room-minutes; manual service plan reconciliation required");
  const debit=await tx.schoolOSUsageEvent.create({data:{
   organizationId,balanceId:bucket.id,metric,kind:"CONSUME",
   units:row.proposedMinutes,requestKey:key,actorId:reviewedBy,
  }});
  await tx.schoolOSVideoUsageReview.update({where:{id:row.id},
   data:{status:"SETTLED",reviewedBy,reviewedAt:now,reviewComment:reviewComment.trim()}});
  await tx.auditLog.create({data:{organizationId,actorId:reviewedBy,
   action:"SCHOOLOS_VIDEO_USAGE_REVIEW_SETTLED",entity:"SchoolOSVideoUsageReview",
   entityId:row.id,metadata:{
    meetingId:row.meetingId,policy:invoiceEvidence,units:row.proposedMinutes,
    signedEvidenceSha256:row.evidenceSha256,ledgerEventId:debit.id,
    evidenceReference:row.evidenceReference,reviewComment:reviewComment.trim(),
    makerId:row.proposedBy,checkerId:reviewedBy,
   }}});
  return {status:"SETTLED" as const,charged:true,minutes:row.proposedMinutes,
   ledgerEventId:debit.id};
 },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
}
