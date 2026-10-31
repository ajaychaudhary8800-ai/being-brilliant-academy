import { Prisma } from "@prisma/client";
import { AppError } from "./http.js";
import { systemPrisma } from "./prisma.js";
import { schoolOSDisputeReleasePolicy } from "./schoolos-dispute-release-policy.js";

export type SchoolOSReleasePaymentEvidence = {
  organizationId: string; provider: string; status: string;
  amountPaise: number; currency: string; providerPaymentId: string | null;
};
export type SchoolOSReleaseAdjustmentEvidence = {
  organizationId: string; providerPaymentId: string;
  amountPaise: number; currency: string;
};

/** Fail closed before maker/checker release on ambiguous or foreign capture evidence. */
export function assertSchoolOSRiskReleasePaymentEvidence(
  organizationId: string, invoiceTotalPaise: number,
  payments: SchoolOSReleasePaymentEvidence[],
  adjustments: SchoolOSReleaseAdjustmentEvidence[],
): void {
  const captured = payments.filter(p => p.status === "CAPTURED");
  const pay = captured[0];
  if (captured.length !== 1 || payments.some(p => p.status === "REFUNDED") ||
      !pay || pay.organizationId !== organizationId || pay.provider !== "RAZORPAY" ||
      !pay.providerPaymentId || pay.currency !== "INR" ||
      !Number.isSafeInteger(invoiceTotalPaise) || invoiceTotalPaise <= 0 ||
      pay.amountPaise !== invoiceTotalPaise ||
      payments.some(p => p.organizationId !== organizationId ||
        p.provider !== "RAZORPAY" || p.currency !== "INR" ||
        !Number.isSafeInteger(p.amountPaise) || p.amountPaise <= 0))
    throw new AppError(409,"SCHOOLOS_RISK_PAYMENT_LEDGER_MISMATCH",
      "Finance hold release requires one valid captured payment and no conflicting payment entries");
  if (adjustments.some(a => a.organizationId !== organizationId ||
      a.providerPaymentId !== pay.providerPaymentId || a.currency !== "INR" ||
      !Number.isSafeInteger(a.amountPaise) || a.amountPaise <= 0 ||
      a.amountPaise > invoiceTotalPaise))
    throw new AppError(409,"SCHOOLOS_RISK_ADJUSTMENT_LEDGER_MISMATCH",
      "Risk adjustment cannot authorize release against unrelated or invalid payment evidence");
}

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
      providerOrderId:true,totalPaise:true,payments:{select:{
        organizationId:true,provider:true,status:true,amountPaise:true,currency:true,providerPaymentId:true,
      }},
    }}),
  ]);
  if (!hold || hold.status!=="ACTIVE" || !invoice || invoice.status!=="PAID" ||
      invoice.organizationId!==hold.organizationId || invoice.currency!=="INR" || !invoice.schoolOSQuoteId ||
      !invoice.providerOrderId)
    throw new AppError(409,"SCHOOLOS_RISK_HOLD_NOT_ELIGIBLE","Active payment-risk hold for a paid SchoolOS invoice required");
  assertSchoolOSRiskReleasePaymentEvidence(invoice.organizationId,invoice.totalPaise,
    invoice.payments,adjustments);
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
