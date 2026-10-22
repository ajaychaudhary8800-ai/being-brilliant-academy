import { Prisma } from "@prisma/client";
import { AppError } from "./http.js";
import { systemPrisma } from "./prisma.js";
import { schoolOSDisputeReleasePolicy } from "./schoolos-dispute-release-policy.js";

async function lockRisk(tx: Prisma.TransactionClient, invoiceId: string) {
  await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext(${"schoolos-risk:"+invoiceId}))`;
}
async function lockUsage(tx: Prisma.TransactionClient, organizationId: string) {
  for (const metric of ["ai_credits","video_minutes"]) {
    await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext(${"schoolos-usage:"+organizationId+":"+metric}))`;
  }
}
async function state(tx: Prisma.TransactionClient, invoiceId: string) {
  const [hold, adjustments, invoice] = await Promise.all([
    tx.schoolOSPaymentRiskHold.findUnique({where:{invoiceId}}),
    tx.schoolOSPaymentAdjustment.findMany({where:{invoiceId},orderBy:{createdAt:"asc"}}),
    tx.saaSInvoice.findUnique({where:{id:invoiceId},select:{
      organizationId:true,status:true,currency:true,schoolOSQuoteId:true,
      providerOrderId:true,totalPaise:true,payments:{select:{status:true,amountPaise:true,currency:true,providerPaymentId:true}},
    }}),
  ]);
  if (!hold || hold.status!=="ACTIVE" || !invoice || invoice.status!=="PAID" ||
      invoice.organizationId!==hold.organizationId || invoice.currency!=="INR" || !invoice.schoolOSQuoteId ||
      !invoice.providerOrderId ||
      invoice.payments.some(payment=>payment.status==="REFUNDED") ||
      !invoice.payments.some(payment=>payment.status==="CAPTURED" && payment.providerPaymentId &&
        payment.currency==="INR" && payment.amountPaise===invoice.totalPaise))
    throw new AppError(409,"SCHOOLOS_RISK_HOLD_NOT_ELIGIBLE","Active payment-risk hold for a paid SchoolOS invoice required");
  const evaluation=schoolOSDisputeReleasePolicy(adjustments);
  if (!evaluation.allowed)
    throw new AppError(409,"SCHOOLOS_RISK_FINANCE_CLEARANCE_DENIED",
      `Refund/dispute evidence prevents release: ${evaluation.reason}`);
  return {hold,adjustments,evaluation};
}

export async function listSchoolOSRiskReviews() {
  const [holds,reviews]=await Promise.all([
    systemPrisma.schoolOSPaymentRiskHold.findMany({
      orderBy:{updatedAt:"desc"},take:100,
      select:{id:true,invoiceId:true,organizationId:true,status:true,revision:true,
        firstEventType:true,latestEventType:true,openedAt:true,updatedAt:true,
        resolvedAt:true,resolvedBy:true,resolutionReference:true},
    }),
    systemPrisma.schoolOSPaymentRiskReview.findMany({
      orderBy:{proposedAt:"desc"},take:150,
    }),
  ]);
  return {holds,reviews};
}

export async function proposeSchoolOSRiskRelease(
 invoiceId: string, proposedBy: string, evidenceReference: string, rationale: string,
) {
 return systemPrisma.$transaction(async tx=>{
   await lockRisk(tx,invoiceId);
   const {hold,evaluation}=await state(tx,invoiceId);
   const review=await tx.schoolOSPaymentRiskReview.create({data:{
     invoiceId,organizationId:hold.organizationId,riskRevision:hold.revision,status:"PENDING",
     proposedBy,evidenceReference,rationale,
   }});
   await tx.auditLog.create({data:{organizationId:hold.organizationId,actorId:proposedBy,
     action:"SCHOOLOS_RISK_RELEASE_PROPOSED",entity:"SchoolOSPaymentRiskReview",entityId:review.id,
     metadata:{invoiceId,riskRevision:hold.revision,evidenceReference,rationale,
       eligibility:evaluation.reason},
   }});
   return review;
 });
}

export async function decideSchoolOSRiskRelease(
 reviewId: string, reviewedBy: string, decision: "APPROVE"|"REJECT", reviewComment: string,
) {
 return systemPrisma.$transaction(async tx=>{
   const initial=await tx.schoolOSPaymentRiskReview.findUnique({where:{id:reviewId}});
   if(!initial)throw new AppError(404,"SCHOOLOS_RISK_REVIEW_NOT_FOUND","Finance review not found");
   await lockRisk(tx,initial.invoiceId);
   const review=await tx.schoolOSPaymentRiskReview.findUniqueOrThrow({where:{id:reviewId}});
   if(review.status!=="PENDING")throw new AppError(409,"SCHOOLOS_RISK_REVIEW_ALREADY_DECIDED","Review already decided");
   if(review.proposedBy===reviewedBy)
     throw new AppError(403,"SCHOOLOS_RISK_MAKER_CHECKER_REQUIRED","Reviewer cannot approve or reject own finance proposal");
   const hold=await tx.schoolOSPaymentRiskHold.findUnique({where:{invoiceId:review.invoiceId}});
   if(!hold || hold.status!=="ACTIVE" || hold.revision!==review.riskRevision ||
       hold.organizationId!==review.organizationId)
     throw new AppError(409,"SCHOOLOS_RISK_STALE_REVIEW","New provider evidence changed this hold; create a fresh review");
   if(decision==="APPROVE") {
     await state(tx,review.invoiceId); // recompute eligibility under serialized lock
     await lockUsage(tx,hold.organizationId);
   }
   const updated=await tx.schoolOSPaymentRiskReview.updateMany({
     where:{id:review.id,status:"PENDING",reviewedBy:null},
     data:{status:decision==="APPROVE"?"APPROVED":"REJECTED",reviewedBy,reviewedAt:new Date(),reviewComment},
   });
   if(updated.count!==1)throw new AppError(409,"SCHOOLOS_RISK_REVIEW_RACE","Review decision changed concurrently");
   if(decision==="APPROVE") {
     const release=await tx.schoolOSPaymentRiskHold.updateMany({
       where:{id:hold.id,revision:hold.revision,status:"ACTIVE"},
       data:{status:"RESOLVED",resolvedAt:new Date(),resolvedBy:reviewedBy,
         resolutionReference:review.evidenceReference},
     });
     if(release.count!==1)throw new AppError(409,"SCHOOLOS_RISK_RELEASE_RACE","Risk hold was modified concurrently");
   }
   await tx.auditLog.create({data:{organizationId:review.organizationId,actorId:reviewedBy,
     action:decision==="APPROVE"?"SCHOOLOS_RISK_RELEASE_APPROVED":"SCHOOLOS_RISK_RELEASE_REJECTED",
     entity:"SchoolOSPaymentRiskReview",entityId:review.id,
     metadata:{invoiceId:review.invoiceId,riskRevision:review.riskRevision,
       proposedBy:review.proposedBy,reviewedBy,decision,reviewComment,
       evidenceReference:review.evidenceReference},
   }});
   return tx.schoolOSPaymentRiskReview.findUniqueOrThrow({where:{id:reviewId}});
 });
}
