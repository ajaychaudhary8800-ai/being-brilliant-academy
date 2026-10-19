import { Prisma } from "@prisma/client";
import { AppError } from "./http.js";
import { systemPrisma } from "./prisma.js";
import { assertSchoolOSUsageRequest } from "./schoolos-usage-policy.js";

/** Proposed V5 policy: one credit per completed primary evaluation, subject to commercial approval. */
export const SCHOOL_OS_AI_CREDIT_POLICY = "EXAMINER_EVALUATION_V1";
const metric = "ai_credits" as const;
function key(evaluationId:string) {
 const requestKey = "ai-examiner:" + evaluationId;
 assertSchoolOSUsageRequest({metric,units:1,requestKey});
 return requestKey;
}
function tenant(organizationId:string) {
 if (!organizationId || organizationId==="org_default")
   throw new AppError(403,"SCHOOLOS_AI_TENANT_REQUIRED","Customer institution required");
}
async function lock(tx: Prisma.TransactionClient,organizationId:string) {
 await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext(${"schoolos-usage:"+organizationId+":"+metric}))`;
}
async function risk(tx:Prisma.TransactionClient,organizationId:string) {
 return tx.schoolOSPaymentRiskHold.findFirst({where:{organizationId,status:"ACTIVE"},select:{id:true}});
}

/** Atomic admission BEFORE a provider call. Replays never authorize another provider attempt. */
export async function reserveSchoolOSAIExaminerCredit(
 organizationId:string,evaluationId:string,actorId:string|null=null,now=new Date(),
) {
 tenant(organizationId);
 const requestKey=key(evaluationId);
 return systemPrisma.$transaction(async tx=>{
  await lock(tx,organizationId);
  const where={organizationId_metric_requestKey:{organizationId,metric,requestKey}};
  const prior=await tx.schoolOSUsageReservation.findUnique({where});
  if(prior) {
   if(prior.actorId!==actorId || prior.units!==1)
     throw new AppError(409,"SCHOOLOS_AI_REPLAY_CONFLICT","Reservation identity changed");
   return {admitted:false,status:prior.status,reservationId:prior.id};
  }
  const priorDebit=await tx.schoolOSUsageEvent.findUnique({where,select:{id:true}});
  if(priorDebit)throw new AppError(409,"SCHOOLOS_AI_USAGE_KEY_CONFLICT","Usage was already billed");
  const org=await tx.organization.findUnique({where:{id:organizationId},
    select:{isActive:true,deletedAt:true,subscriptionStatus:true,subscriptionEndsAt:true}});
  if(!org || !org.isActive || org.deletedAt || org.subscriptionStatus!=="ACTIVE" ||
    !org.subscriptionEndsAt || org.subscriptionEndsAt<=now)
   throw new AppError(403,"SCHOOLOS_AI_SUBSCRIPTION_INACTIVE","Active customer subscription required");
  if(await risk(tx,organizationId))
   throw new AppError(409,"SCHOOLOS_AI_PAYMENT_HOLD","Finance review blocks AI credit reservations");
  const buckets=await tx.schoolOSUsageBalance.findMany({where:{
   organizationId,metric,periodStart:{lte:now},periodEnd:{gt:now},
  }});
  if(buckets.length!==1)throw new AppError(409,"SCHOOLOS_AI_PERIOD_INVALID","Exactly one active paid credit period required");
  const bucket=buckets[0]!;
  const grant=await tx.schoolOSUsageEvent.findFirst({where:{
   organizationId,balanceId:bucket.id,metric,kind:"GRANT",
   sourceInvoice:{is:{organizationId,status:"PAID",
    OR:[{schoolOSPaymentRiskHold:{is:null}},{schoolOSPaymentRiskHold:{is:{status:"RESOLVED"}}}]}},
  },select:{id:true}});
  if(!grant)throw new AppError(409,"SCHOOLOS_AI_PAID_GRANT_MISSING","Verified paid AI credit grant required");
  const available=await tx.schoolOSUsageBalance.updateMany({where:{
   id:bucket.id,consumedUnits:{lt:bucket.grantedUnits},
  },data:{consumedUnits:{increment:1}}});
  if(available.count!==1)throw new AppError(402,"SCHOOLOS_AI_CREDIT_EXHAUSTED","No prepaid AI credits remain");
  const reserved=await tx.schoolOSUsageReservation.create({data:{
   organizationId,balanceId:bucket.id,metric,requestKey,units:1,status:"RESERVED",actorId,
  }});
  await tx.auditLog.create({data:{organizationId,actorId,action:"SCHOOLOS_AI_CREDIT_RESERVED",
   entity:"SchoolOSUsageReservation",entityId:reserved.id,
   metadata:{evaluationId,policy:SCHOOL_OS_AI_CREDIT_POLICY}}});
  return {admitted:true,status:"RESERVED",reservationId:reserved.id};
 },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
}

/** Call only after provider-confirmed billable evaluation. Late risk holds block closure. */
export async function commitSchoolOSAIExaminerCredit(organizationId:string,evaluationId:string) {
 tenant(organizationId);const requestKey=key(evaluationId);
 return systemPrisma.$transaction(async tx=>{
  await lock(tx,organizationId);
  const row=await tx.schoolOSUsageReservation.findUnique({where:{
   organizationId_metric_requestKey:{organizationId,metric,requestKey},
  }});
  if(!row)throw new AppError(404,"SCHOOLOS_AI_RESERVATION_MISSING","No AI reservation found");
  if(row.status==="RELEASED")throw new AppError(409,"SCHOOLOS_AI_CREDIT_RELEASED","Released reservation is final");
  if(row.status==="COMMITTED")return {committed:false,reservationId:row.id};
  if(await risk(tx,organizationId))
   throw new AppError(409,"SCHOOLOS_AI_COMMIT_FINANCE_HOLD","Provider outcome requires finance reconciliation");
  await tx.schoolOSUsageEvent.create({data:{
   organizationId,balanceId:row.balanceId,metric,kind:"CONSUME",units:row.units,
   requestKey,actorId:row.actorId,
  }});
  await tx.schoolOSUsageReservation.update({where:{id:row.id},
   data:{status:"COMMITTED",committedAt:new Date()}});
  await tx.auditLog.create({data:{organizationId,actorId:row.actorId,
   action:"SCHOOLOS_AI_CREDIT_COMMITTED",entity:"SchoolOSUsageReservation",
   entityId:row.id,metadata:{evaluationId,policy:SCHOOL_OS_AI_CREDIT_POLICY}}});
  return {committed:true,reservationId:row.id};
 },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
}

/** Only conclusive evidence of no billable provider execution allows a reversal. */
export async function releaseSchoolOSAIExaminerCredit(
 organizationId:string,evaluationId:string,reason:string,
) {
 tenant(organizationId);const requestKey=key(evaluationId);
 if(typeof reason!=="string"||reason.trim().length<12||reason.trim().length>500)
  throw new AppError(422,"SCHOOLOS_AI_RELEASE_PROOF_REQUIRED","Provide conclusive non-billable failure evidence");
 return systemPrisma.$transaction(async tx=>{
  await lock(tx,organizationId);
  const row=await tx.schoolOSUsageReservation.findUnique({where:{
   organizationId_metric_requestKey:{organizationId,metric,requestKey},
  }});
  if(!row)throw new AppError(404,"SCHOOLOS_AI_RESERVATION_MISSING","No AI reservation found");
  if(row.status==="COMMITTED")throw new AppError(409,"SCHOOLOS_AI_ALREADY_BILLED","Committed use cannot be reversed");
  if(row.status==="RELEASED")return {released:false,reservationId:row.id};
  const restored=await tx.schoolOSUsageBalance.updateMany({where:{
   id:row.balanceId,organizationId,metric,consumedUnits:{gte:1},
  },data:{consumedUnits:{decrement:1}}});
  if(restored.count!==1)throw new AppError(409,"SCHOOLOS_AI_BALANCE_CORRUPT","Reserved balance cannot be restored");
  await tx.schoolOSUsageReservation.update({where:{id:row.id},
   data:{status:"RELEASED",releasedAt:new Date(),releaseReason:reason.trim()}});
  await tx.auditLog.create({data:{organizationId,actorId:row.actorId,
   action:"SCHOOLOS_AI_CREDIT_RELEASED",entity:"SchoolOSUsageReservation",
   entityId:row.id,metadata:{evaluationId,reason:reason.trim()}}});
  return {released:true,reservationId:row.id};
 },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
}
