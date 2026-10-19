import { Prisma } from "@prisma/client";
import { env } from "../config.js";
import { AppError } from "./http.js";
import { systemPrisma } from "./prisma.js";
import { isSchoolOSVideoEvidenceEnabled } from "./schoolos-livekit-evidence-service.js";
import { assertSchoolOSUsageRequest } from "./schoolos-usage-policy.js";

export const SCHOOL_OS_VIDEO_ROOM_POLICY="VIDEO_ROOM_MINUTES_V1";
export const SCHOOL_OS_VIDEO_MAX_PREAUTHORIZED_MINUTES=240;
const metric="video_minutes" as const;
export const schoolOSVideoReservationKey=(meetingId:string)=>"video-meeting:"+meetingId;
export function schoolOSVideoAdmissionEnabled(organizationId:string){
 return Boolean(organizationId && organizationId!=="org_default" &&
  env.SCHOOLOS_VIDEO_ADMISSION_ENABLED &&
  isSchoolOSVideoEvidenceEnabled(organizationId,env.SCHOOLOS_VIDEO_ADMISSION_TENANT_IDS) &&
  env.SCHOOLOS_VIDEO_SETTLEMENT_ENABLED &&
  isSchoolOSVideoEvidenceEnabled(organizationId,env.SCHOOLOS_VIDEO_SETTLEMENT_TENANT_IDS) &&
  env.SCHOOLOS_VIDEO_WEBHOOK_ENABLED &&
  isSchoolOSVideoEvidenceEnabled(organizationId,env.SCHOOLOS_VIDEO_EVIDENCE_TENANT_IDS));
}
export function schoolOSVideoReservationWindow(meeting:{
 startsAt:Date;endsAt:Date;
},now:Date){
 const start=meeting.startsAt.getTime()-10*60_000,end=meeting.endsAt.getTime();
 if(!Number.isFinite(start)||!Number.isFinite(end) || end<=start ||
    now.getTime()<start || now.getTime()>=end)
  throw new AppError(409,"SCHOOLOS_VIDEO_ADMISSION_WINDOW","Prepaid video rooms can open at most ten minutes early and not after scheduled end");
 const units=Math.ceil((end-start)/60000);
 if(units<1||units>SCHOOL_OS_VIDEO_MAX_PREAUTHORIZED_MINUTES)
  throw new AppError(409,"SCHOOLOS_VIDEO_ROOM_BUDGET_INVALID","Metered room budget exceeds permitted four-hour prepaid window");
 return {units,preauthorizedFrom:new Date(start),preauthorizedUntil:new Date(end),
  tokenTtlSeconds:Math.max(1,Math.min(4*3600,Math.floor((end-now.getTime())/1000)))};
}
/**
 * Server-only and exact opt-in. Debits a HOLD against prepaid capacity, not a
 * financial CONSUME event. Repeated participant join in the same room is safe;
 * separate rooms cannot overspend the same tenant balance.
 */
export async function authorizeSchoolOSPrepaidVideoRoom(
 organizationId:string,meetingId:string,now=new Date()){
 if(!schoolOSVideoAdmissionEnabled(organizationId))
  return {enforced:false,admitted:true,heldMinutes:0,tokenTtlSeconds:4*3600};
 if(!meetingId || meetingId.length>100)
  throw new AppError(422,"SCHOOLOS_VIDEO_MEETING_INVALID","Meeting reference required");
 const requestKey=schoolOSVideoReservationKey(meetingId);
 assertSchoolOSUsageRequest({metric,requestKey,units:1});
 return systemPrisma.$transaction(async tx=>{
  // The room lock is shared with provider webhook ingestion and settlement.
  await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext(${"schoolos-video:"+meetingId}))`;
  await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext(${"schoolos-usage:"+organizationId+":"+metric}))`;
  const meeting=await tx.meeting.findFirst({where:{id:meetingId,organizationId},
   select:{id:true,hostUserId:true,startsAt:true,endsAt:true,status:true}});
  if(!meeting)throw new AppError(404,"SCHOOLOS_VIDEO_MEETING_NOT_FOUND","Tenant meeting not found");
  if(!["SCHEDULED","OPEN_FOR_JOIN","LIVE"].includes(meeting.status))
   throw new AppError(409,"SCHOOLOS_VIDEO_MEETING_INACTIVE","Meeting is not joinable");
  const window=schoolOSVideoReservationWindow(meeting,now);
  const organization=await tx.organization.findUnique({where:{id:organizationId},
   select:{isActive:true,deletedAt:true,subscriptionStatus:true,subscriptionEndsAt:true}});
  if(!organization||!organization.isActive||organization.deletedAt||
      organization.subscriptionStatus!=="ACTIVE"||!organization.subscriptionEndsAt||
      organization.subscriptionEndsAt<=now)
   throw new AppError(403,"SCHOOLOS_VIDEO_SUBSCRIPTION_INACTIVE","An active paid subscription is required");
  const financialHold=await tx.schoolOSPaymentRiskHold.findFirst({where:{organizationId,status:"ACTIVE"},
   select:{id:true}});
  if(financialHold)throw new AppError(409,"SCHOOLOS_VIDEO_FINANCE_HOLD","Financial risk blocks new video sessions");
  const previous=await tx.schoolOSUsageReservation.findUnique({
   where:{organizationId_metric_requestKey:{organizationId,metric,requestKey}},
  });
  if(previous){
   if(previous.status!=="RESERVED"||previous.units!==window.units||
      previous.actorId!==meeting.hostUserId)
    throw new AppError(409,"SCHOOLOS_VIDEO_RESERVATION_FINAL",
     "Room budget has already been reconciled or the original reservation changed");
   return {enforced:true,admitted:true,reservedNow:false,reservationId:previous.id,
    heldMinutes:previous.units,tokenTtlSeconds:window.tokenTtlSeconds};
  }
  const buckets=await tx.schoolOSUsageBalance.findMany({where:{
   organizationId,metric,periodStart:{lte:window.preauthorizedFrom},
   periodEnd:{gte:window.preauthorizedUntil},
  }});
  if(buckets.length!==1 || buckets[0]!.periodEnd<=now)
   throw new AppError(409,"SCHOOLOS_VIDEO_PERIOD_UNAVAILABLE",
    "A single active prepaid period must cover the full room budget");
  const bucket=buckets[0]!;
  const verified=await tx.schoolOSUsageEvent.findFirst({where:{
   organizationId,balanceId:bucket.id,metric,kind:"GRANT",
   sourceInvoice:{is:{
    organizationId,status:"PAID",paidAt:{not:null},schoolOSQuoteId:{not:null},
    providerOrderId:{not:null},
    schoolOSQuote:{is:{organizationId,status:"PAID",contractDocumentId:{not:null}}},
    payments:{some:{status:"CAPTURED",providerPaymentId:{not:null}}},
    OR:[{schoolOSPaymentRiskHold:{is:null}},{schoolOSPaymentRiskHold:{is:{status:"RESOLVED"}}}],
   }},
  },select:{id:true}});
  if(!verified)throw new AppError(409,"SCHOOLOS_VIDEO_PAID_GRANT_MISSING",
   "Verified captured signed-quote video credits required");
  const adjusted=await tx.schoolOSUsageBalance.updateMany({
   where:{id:bucket.id,organizationId,metric,
    consumedUnits:{lte:bucket.grantedUnits-window.units}},
   data:{consumedUnits:{increment:window.units}},
  });
  if(adjusted.count!==1)
   throw new AppError(402,"SCHOOLOS_VIDEO_CREDITS_INSUFFICIENT",
    "Insufficient prepaid video minutes for the full scheduled room budget");
  const reservation=await tx.schoolOSUsageReservation.create({data:{
   organizationId,balanceId:bucket.id,metric,requestKey,units:window.units,
   status:"RESERVED",actorId:meeting.hostUserId,
  }});
  await tx.auditLog.create({data:{organizationId,actorId:meeting.hostUserId,
   action:"SCHOOLOS_VIDEO_MINUTES_HELD",entity:"SchoolOSUsageReservation",
   entityId:reservation.id,metadata:{meetingId,units:window.units,
    policy:SCHOOL_OS_VIDEO_ROOM_POLICY,expiresAt:window.preauthorizedUntil.toISOString()}}});
  return {enforced:true,admitted:true,reservedNow:true,reservationId:reservation.id,
   heldMinutes:window.units,tokenTtlSeconds:window.tokenTtlSeconds};
 },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
}
