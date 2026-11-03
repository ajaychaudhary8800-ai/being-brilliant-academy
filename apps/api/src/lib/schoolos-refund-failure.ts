import { AppError } from "./http.js";
import { systemPrisma } from "./prisma.js";

/**
 * Only after successful raw-body Razorpay webhook HMAC verification. This
 * V5-only operational event does NOT represent a processed cash refund,
 * does NOT mutate a captured payment and does NOT release a risk hold.
 */
export type SchoolOSFailedRefund = {
  refundId: string; paymentId: string; orderId: string | null;
  amountPaise: number; originalAmountPaise: number; currency: string;
  status: "failed";
};
export function validateSchoolOSFailedRefund(input: SchoolOSFailedRefund) {
  if (!/^rfnd_[A-Za-z0-9]+$/.test(input.refundId) ||
      !/^pay_[A-Za-z0-9]+$/.test(input.paymentId) ||
      (input.orderId !== null && !/^order_[A-Za-z0-9]+$/.test(input.orderId)))
    throw new AppError(422, "SCHOOLOS_REFUND_FAILURE_ID_INVALID",
      "Invalid provider failed-refund identifiers");
  if (input.status !== "failed" ||
      !Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0 ||
      !Number.isSafeInteger(input.originalAmountPaise) || input.originalAmountPaise <= 0 ||
      input.amountPaise > input.originalAmountPaise || input.currency.toUpperCase() !== "INR")
    throw new AppError(422, "SCHOOLOS_REFUND_FAILURE_EVIDENCE_INVALID",
      "Invalid provider refund failure state or amount");
  return {...input, currency:"INR" as const};
}
const jsonRecord = (value:unknown):Record<string,unknown> =>
  value && typeof value==="object" && !Array.isArray(value)
    ? value as Record<string,unknown> : {};

/** Acknowledging a failed refund is never equivalent to refund.processed. */
export async function recordSchoolOSFailedRefund(input:SchoolOSFailedRefund):Promise<boolean> {
  const e=validateSchoolOSFailedRefund(input);
  const pre=await systemPrisma.saaSPayment.findUnique({
    where:{providerPaymentId:e.paymentId},
    select:{invoice:{select:{id:true,schoolOSQuoteId:true,providerOrderId:true}}},
  });
  const candidate=pre?.invoice;
  if (!candidate?.schoolOSQuoteId) {
    // Reject a signed provider identity attached to a known V5 order when
    // the supposedly captured original payment cannot be independently found.
    if (e.orderId) {
      const quote=await systemPrisma.saaSInvoice.findUnique({
        where:{providerOrderId:e.orderId},select:{schoolOSQuoteId:true},
      });
      if (quote?.schoolOSQuoteId)
        throw new AppError(409,"SCHOOLOS_REFUND_FAILURE_CAPTURE_MISSING",
          "Signed refund failure references an unverified contracted capture");
    }
    return false; // Legacy V4/learner-fee behaviour unchanged.
  }
  const eventKey=`refund.failed:${e.refundId}`;
  const safePayload={refundId:e.refundId,paymentId:e.paymentId,
    orderId:e.orderId,amountPaise:e.amountPaise,currency:"INR",status:"failed"};
  await systemPrisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext(${"schoolos-risk:"+candidate.id}))`;
    const invoice=await tx.saaSInvoice.findUnique({where:{id:candidate.id},select:{
      id:true,organizationId:true,schoolOSQuoteId:true,providerOrderId:true,provider:true,
      totalPaise:true,currency:true,status:true,
    }});
    const payment=await tx.saaSPayment.findUnique({where:{providerPaymentId:e.paymentId}});
    if(!invoice || invoice.schoolOSQuoteId!==candidate.schoolOSQuoteId ||
       !invoice.providerOrderId || (e.orderId!==null && invoice.providerOrderId!==e.orderId) ||
       invoice.provider!=="RAZORPAY" || invoice.currency!=="INR" ||
       invoice.totalPaise!==e.originalAmountPaise || invoice.status!=="PAID" ||
       !payment || payment.invoiceId!==invoice.id || payment.organizationId!==invoice.organizationId ||
       payment.provider!=="RAZORPAY" || payment.amountPaise!==e.originalAmountPaise ||
       payment.currency!=="INR" || !["CAPTURED","REFUNDED"].includes(payment.status))
      throw new AppError(409,"SCHOOLOS_REFUND_FAILURE_SOURCE_MISMATCH",
        "Failed refund does not match the recorded original captured SchoolOS payment");
    const previous=await tx.saaSWebhookEvent.findUnique({
      where:{provider_eventKey:{provider:"RAZORPAY",eventKey}},
    });
    if(previous) {
      const old=jsonRecord(previous.payload);
      if(previous.eventType!=="refund.failed" || !previous.processedAt ||
         Object.keys(old).length!==Object.keys(safePayload).length ||
         Object.entries(safePayload).some(([key,value])=>old[key]!==value))
        throw new AppError(409,"SCHOOLOS_REFUND_FAILURE_REPLAY_CONFLICT",
          "Failed-refund identifier has conflicting evidence");
      return;
    }
    const settled=await tx.schoolOSPaymentAdjustment.findUnique({
      where:{eventKey:`refund.processed:${e.refundId}`},
    });
    if(settled)
      throw new AppError(409,"SCHOOLOS_REFUND_FAILURE_AFTER_PROCESSED",
        "Provider reports conflicting refund outcome; independent finance reconciliation required");
    await tx.saaSWebhookEvent.create({data:{
      provider:"RAZORPAY",eventKey,eventType:"refund.failed",
      payload:safePayload,processedAt:new Date(),
    }});
    await tx.auditLog.create({data:{
      organizationId:invoice.organizationId,action:"SCHOOLOS_REFUND_PROCESSING_FAILED",
      entity:"SaaSInvoice",entityId:invoice.id,
      metadata:{providerEventKey:eventKey,refundId:e.refundId,paymentId:e.paymentId,
        amountPaise:e.amountPaise,policy:"MANUAL_FINANCE_ACTION_NO_CASH_REFUND"},
    }});
  });
  return true;
}
