import { Prisma, SaaSPaymentStatus } from "@prisma/client";
import { AppError } from "./http.js";
import { systemPrisma } from "./prisma.js";
import { validateSchoolOSFailedPayment, type SchoolOSFailedPaymentEvidence } from "./schoolos-payment-failure-policy.js";

function rec(value: unknown): Record<string,unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string,unknown> : {};
}

/** Invoke ONLY after webhook raw-body HMAC verification.
 * A failed attempt never deactivates a paid contract, creates another order,
 * extends renewal terms or grants purchased add-ons.
 */
export async function recordSchoolOSFailedPayment(evidence: SchoolOSFailedPaymentEvidence): Promise<boolean> {
  const e = validateSchoolOSFailedPayment(evidence);
  const lookup = await systemPrisma.saaSInvoice.findUnique({
    where: {providerOrderId:e.orderId},
    select: {id:true,schoolOSQuoteId:true,organizationId:true},
  });
  if (!lookup?.schoolOSQuoteId) return false; // Learner-fee payments remain outside SchoolOS billing.

  const eventKey = `payment.failed:${e.providerPaymentId}`;
  const safePayload = {
    providerPaymentId:e.providerPaymentId, orderId:e.orderId,
    amountPaise:e.amountPaise, currency:"INR", errorCode:e.errorCode,
  };
  await systemPrisma.$transaction(async tx=>{
    // Serialize against verified capture; delayed failed notifications must not
    // downgrade a successfully captured provider payment.
    await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext(${"schoolos-renewal-settlement:"+lookup.organizationId}))`;
    const invoice = await tx.saaSInvoice.findUnique({
      where:{id:lookup.id},select:{
        id:true,organizationId:true,schoolOSQuoteId:true,status:true,providerOrderId:true,
        totalPaise:true,currency:true,schoolOSQuote:{select:{status:true}},
      },
    });
    if (!invoice || invoice.organizationId!==lookup.organizationId ||
        invoice.schoolOSQuoteId!==lookup.schoolOSQuoteId ||
        invoice.providerOrderId!==e.orderId || invoice.totalPaise!==e.amountPaise ||
        invoice.currency!=="INR")
      throw new AppError(409,"SCHOOLOS_PAYMENT_FAILURE_SOURCE_MISMATCH",
        "Signed failed payment does not match the customer quotation invoice");

    const priorPayment = await tx.saaSPayment.findUnique({where:{providerPaymentId:e.providerPaymentId}});
    if (priorPayment && (priorPayment.organizationId!==invoice.organizationId ||
        priorPayment.invoiceId!==invoice.id || priorPayment.amountPaise!==e.amountPaise ||
        priorPayment.currency!=="INR" || priorPayment.provider!=="RAZORPAY"))
      throw new AppError(409,"SCHOOLOS_PAYMENT_FAILURE_REPLAY_CONFLICT","Failure payment ID belongs to different financial evidence");

    const previous=await tx.saaSWebhookEvent.findUnique({
      where:{provider_eventKey:{provider:"RAZORPAY",eventKey}},
    });
    const prev=rec(previous?.payload);
    // PostgreSQL jsonb normalizes key ordering: compare normalized fields,
    // not serialized object bytes, to preserve genuine idempotent delivery.
    if (previous && (
      previous.eventType!=="payment.failed" ||
      Object.keys(prev).length!==5 ||
      prev.providerPaymentId!==safePayload.providerPaymentId ||
      prev.orderId!==safePayload.orderId ||
      prev.amountPaise!==safePayload.amountPaise ||
      prev.currency!==safePayload.currency ||
      prev.errorCode!==safePayload.errorCode))
      throw new AppError(409,"SCHOOLOS_PAYMENT_FAILURE_REPLAY_CONFLICT",
        "Provider event replay contains conflicting evidence");
    if (previous?.processedAt) return;

    if (invoice.status==="PAID" || priorPayment?.status===SaaSPaymentStatus.CAPTURED ||
        priorPayment?.status===SaaSPaymentStatus.REFUNDED) return;
    if (invoice.status!=="OPEN" || invoice.schoolOSQuote?.status!=="PAYMENT_PENDING")
      throw new AppError(409,"SCHOOLOS_PAYMENT_FAILURE_STATE_CONFLICT",
        "This signed SchoolOS order is not accepting new payment attempts");
    if (priorPayment && priorPayment.status!==SaaSPaymentStatus.FAILED)
      throw new AppError(409,"SCHOOLOS_PAYMENT_FAILURE_STATE_CONFLICT",
        "An unsettled provider payment requires reconciliation before marking it failed");

    if (!priorPayment) await tx.saaSPayment.create({data:{
      organizationId:invoice.organizationId,invoiceId:invoice.id,provider:"RAZORPAY",
      providerPaymentId:e.providerPaymentId,amountPaise:e.amountPaise,currency:"INR",
      status:SaaSPaymentStatus.FAILED,
    }});
    await tx.saaSWebhookEvent.upsert({
      where:{provider_eventKey:{provider:"RAZORPAY",eventKey}},
      create:{provider:"RAZORPAY",eventKey,eventType:"payment.failed",
        payload:safePayload as Prisma.InputJsonValue,processedAt:new Date()},
      update:{processedAt:new Date()},
    });
    await tx.auditLog.create({data:{
      organizationId:invoice.organizationId,action:"SCHOOLOS_CONTRACT_PAYMENT_ATTEMPT_FAILED",
      entity:"SaaSInvoice",entityId:invoice.id,
      metadata:{eventKey,reasonCode:e.errorCode,policy:"RETRY_SAME_ORDER_OR_FINANCE_REVIEW"},
    }});
  });
  return true;
}
