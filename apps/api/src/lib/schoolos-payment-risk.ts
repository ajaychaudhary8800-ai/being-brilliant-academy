import { Prisma, SaaSPaymentStatus } from "@prisma/client";
import { AppError } from "./http.js";
import { systemPrisma } from "./prisma.js";

export type SchoolOSRiskEventType = "refund.processed" | "payment.dispute.created" | "payment.dispute.lost" | "payment.dispute.won";
export type SchoolOSRiskEvent = {
  type: SchoolOSRiskEventType;
  entityId: string;
  providerPaymentId: string;
  orderId: string | null;
  originalAmountPaise: number;
  amountPaise: number;
  currency: string;
};

export function validateSchoolOSRiskEvent(input: SchoolOSRiskEvent) {
  if (!["refund.processed", "payment.dispute.created", "payment.dispute.lost", "payment.dispute.won"].includes(input.type))
    throw new AppError(422, "SCHOOLOS_RISK_EVENT_UNSUPPORTED", "Unsupported reversal event");
  if (!/^(rfnd_|disp_)[A-Za-z0-9]+$/.test(input.entityId)
    || !/^pay_[A-Za-z0-9]+$/.test(input.providerPaymentId)
    || (input.orderId!==null && !/^order_[A-Za-z0-9]+$/.test(input.orderId)))
    throw new AppError(422, "SCHOOLOS_RISK_EVENT_ID_INVALID", "Provider refund or dispute evidence is invalid");
  if (input.type === "refund.processed" ? !input.entityId.startsWith("rfnd_") : !input.entityId.startsWith("disp_"))
    throw new AppError(422, "SCHOOLOS_RISK_EVENT_ENTITY_MISMATCH", "Provider entity does not match event type");
  if (!Number.isSafeInteger(input.originalAmountPaise) || input.originalAmountPaise <= 0 ||
      !Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0 ||
      input.amountPaise > input.originalAmountPaise || input.currency.toUpperCase() !== "INR")
    throw new AppError(422, "SCHOOLOS_RISK_EVENT_AMOUNT_INVALID", "Payment or refund amount is invalid");
  return { ...input, currency: "INR", eventKey: `${input.type}:${input.entityId}` };
}

/** Signed Razorpay webhook processor. Does not trigger any provider refund itself.
 * Source document, original capture, tenant ownership and replay keys must all match.
 * Partial refund or disputed amount conservatively suspends ALL add-ons on this invoice.
 */
export async function recordSchoolOSPaymentRisk(input: SchoolOSRiskEvent, originalEvent: unknown): Promise<boolean> {
  const e=validateSchoolOSRiskEvent(input);
  // Some signed dispute payloads have payment.order_id=null. Resolve from the
  // independently captured provider payment record, never from a client-supplied tenant ID.
  const captured=await systemPrisma.saaSPayment.findUnique({
    where: {providerPaymentId:e.providerPaymentId},
    select: {invoice: {select:{id:true,schoolOSQuoteId:true,providerOrderId:true}}},
  });
  const possible=captured?.invoice;
  if (!possible || !possible.schoolOSQuoteId) return false;
  if (e.orderId!==null && possible.providerOrderId!==e.orderId)
    throw new AppError(409,"SCHOOLOS_RISK_ORDER_MISMATCH","Signed payment order does not match captured SaaS invoice");

  await systemPrisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext(${"schoolos-risk:"+possible.id}))`;
    const invoice=await tx.saaSInvoice.findUnique({
      where:{id:possible.id},select:{id:true,organizationId:true,schoolOSQuoteId:true,status:true,providerOrderId:true,
        totalPaise:true,currency:true},
    });
    if (!invoice || invoice.schoolOSQuoteId!==possible.schoolOSQuoteId || invoice.status!=="PAID" ||
        (e.orderId!==null && invoice.providerOrderId!==e.orderId) || !invoice.providerOrderId || invoice.totalPaise!==e.originalAmountPaise ||
        invoice.currency!=="INR" || e.currency!=="INR")
      throw new AppError(409,"SCHOOLOS_RISK_INVOICE_MISMATCH","Risk event does not match a captured, paid quotation invoice");
    const payment=await tx.saaSPayment.findUnique({where:{providerPaymentId:e.providerPaymentId}});
    if (!payment || payment.invoiceId!==invoice.id || payment.organizationId!==invoice.organizationId ||
        payment.amountPaise!==invoice.totalPaise || payment.currency!=="INR" ||
        (payment.status!==SaaSPaymentStatus.CAPTURED && payment.status!==SaaSPaymentStatus.REFUNDED))
      throw new AppError(409,"SCHOOLOS_RISK_CAPTURE_NOT_VERIFIED","No matching captured payment found");

    const existing=await tx.schoolOSPaymentAdjustment.findUnique({where:{eventKey:e.eventKey}});
    if (existing) {
      if (existing.invoiceId!==invoice.id || existing.organizationId!==invoice.organizationId ||
          existing.providerPaymentId!==e.providerPaymentId || existing.amountPaise!==e.amountPaise ||
          existing.eventType!==e.type || existing.providerEntityId!==e.entityId)
        throw new AppError(409,"SCHOOLOS_RISK_EVENT_REPLAY_CONFLICT","Provider event key was reused with changed details");
      return;
    }
    if (e.type==="refund.processed") {
      const refunds=await tx.schoolOSPaymentAdjustment.aggregate({where:{
        invoiceId:invoice.id,eventType:"refund.processed",
      },_sum:{amountPaise:true}});
      if ((refunds._sum.amountPaise??0)+e.amountPaise>invoice.totalPaise)
        throw new AppError(409,"SCHOOLOS_REFUND_TOTAL_EXCEEDED","Processed refund aggregate exceeds original payment");
    }
    // A win is evidence of a pre-existing dispute, not a new financial loss.
    // Even a matching signed won event cannot release a hold by itself.
    if (e.type==="payment.dispute.won") {
      const raised=await tx.schoolOSPaymentAdjustment.findUnique({
        where:{eventKey:`payment.dispute.created:${e.entityId}`},
      });
      if (!raised || raised.invoiceId!==invoice.id || raised.providerPaymentId!==e.providerPaymentId)
        throw new AppError(409,"SCHOOLOS_RISK_DISPUTE_NOT_RAISED","Won notification has no recorded source dispute");
    }
    await tx.schoolOSPaymentAdjustment.create({data:{
      invoiceId:invoice.id,organizationId:invoice.organizationId,eventType:e.type,
      eventKey:e.eventKey,providerEntityId:e.entityId,providerPaymentId:e.providerPaymentId,
      amountPaise:e.amountPaise,currency:"INR",
    }});
    // Serialize the transition into a risk hold with service-level AI/video debits.
    // A debit fully finishes before the hold, or observes the committed hold.
    for (const metric of ["ai_credits", "video_minutes"] as const) {
      await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext(${"schoolos-usage:"+invoice.organizationId+":"+metric}))`;
    }
    await tx.schoolOSPaymentRiskHold.upsert({
      where:{invoiceId:invoice.id},
      create:{
        invoiceId:invoice.id,organizationId:invoice.organizationId,status:"ACTIVE",revision:1,
        firstEventType:e.type,latestEventType:e.type,firstEventKey:e.eventKey,latestEventKey:e.eventKey,
      },
      update:{status:"ACTIVE",revision:{increment:1},latestEventType:e.type,latestEventKey:e.eventKey,
        resolvedAt:null,resolvedBy:null,resolutionReference:null},
    });
    await tx.saaSWebhookEvent.upsert({
      where:{provider_eventKey:{provider:"RAZORPAY",eventKey:e.eventKey}},
      create:{provider:"RAZORPAY",eventKey:e.eventKey,eventType:e.type,payload:originalEvent as Prisma.InputJsonValue,
        processedAt:new Date()},
      update:{processedAt:new Date()},
    });
    await tx.auditLog.create({data:{
      organizationId:invoice.organizationId,action:"SCHOOLOS_PAYMENT_RISK_HOLD",
      entity:"SaaSInvoice",entityId:invoice.id,
      metadata:{eventType:e.type,providerEventKey:e.eventKey,amountPaise:e.amountPaise,
        policy:"HOLD_ADDON_ENTITLEMENTS_PENDING_FINANCE_REVIEW"},
    }});
  });
  return true;
}
