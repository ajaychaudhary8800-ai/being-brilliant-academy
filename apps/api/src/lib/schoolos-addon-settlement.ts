import { Prisma } from "@prisma/client";
import { AppError } from "./http.js";
import type { SchoolOSApprovedAddonLine } from "./schoolos-addon-checkout-policy.js";
const MAX_UNITS=2_147_483_647;

/** Call exclusively inside the verified Razorpay capture transaction, after PAID invoice+quote updates. */
export async function applySchoolOSPaidAddonSettlement(
  tx: Prisma.TransactionClient,
  input: {organizationId: string; invoiceId: string; quoteId: string; periodStart: Date; periodEnd: Date;
    totalPaise: number; lines: SchoolOSApprovedAddonLine[]},
) {
  const [invoice, quote, payment] = await Promise.all([
    tx.saaSInvoice.findUnique({where:{id:input.invoiceId},select:{organizationId:true,status:true,schoolOSQuoteId:true,totalPaise:true,metadata:true,providerOrderId:true}}),
    tx.schoolOSQuotation.findUnique({where:{id:input.quoteId},select:{organizationId:true,status:true,totalPaise:true,items:true}}),
    tx.saaSPayment.findFirst({where:{invoiceId:input.invoiceId,organizationId:input.organizationId,status:"CAPTURED",
      amountPaise:input.totalPaise,currency:"INR",providerPaymentId:{not:null}}}),
  ]);
  if (!invoice || invoice.status!=="PAID" || invoice.organizationId!==input.organizationId ||
    invoice.schoolOSQuoteId!==input.quoteId || invoice.totalPaise!==input.totalPaise ||
    !quote || quote.organizationId!==input.organizationId || quote.status!=="PAID" || quote.totalPaise!==input.totalPaise
    || !payment || !invoice.providerOrderId)
    throw new AppError(409,"SCHOOLOS_ADDON_ACTIVATION_NOT_PAID","Verified paid matching invoice and quotation required");
  const meta=invoice.metadata && typeof invoice.metadata==="object" && !Array.isArray(invoice.metadata)
    ? invoice.metadata as Record<string,unknown> : {};
  // Re-read source quotation line values before any grant. Invoice metadata alone
  // is not sufficient evidence of customer-authorised quantity and unit price.
  if (!Array.isArray(quote.items) || quote.items.length!==input.lines.length ||
      input.lines.some((line,index)=>{
        const raw=quote.items as unknown[];
        const item=raw[index] && typeof raw[index]==="object" && !Array.isArray(raw[index])
          ? raw[index] as Record<string,unknown> : {};
        return item.category!==line.category || item.code!==line.code ||
          item.label!==line.label || item.quantity!==line.quantity ||
          item.unitPricePaise!==line.unitPricePaise;
      }))
    throw new AppError(409,"SCHOOLOS_ADDON_SIGNED_LINES_CHANGED","Signed quote line details have changed");
  const stored=meta.addonLines;
  if (meta.basis!=="SIGNED_ANNUAL_BASE_PLUS_ADDONS" || !Array.isArray(stored) ||
    JSON.stringify(stored)!==JSON.stringify(input.lines))
    throw new AppError(409,"SCHOOLOS_ADDON_INVOICE_LINES_CHANGED","Captured invoice line details differ from approved quotation");
  const licensed=input.lines.filter(x=>x.category==="MODULE"||x.category==="CAPACITY");
  if (licensed.length) {
    await tx.schoolOSAddonLicense.createMany({
      data:licensed.map(line=>({
        organizationId:input.organizationId,invoiceId:input.invoiceId,quoteId:input.quoteId,
        category:line.category,code:line.code,units:line.quantity,
        periodStart:input.periodStart,periodEnd:input.periodEnd,
      })), skipDuplicates:true,
    });
    const records=await tx.schoolOSAddonLicense.findMany({where:{invoiceId:input.invoiceId}});
    if (records.length!==licensed.length || licensed.some(line=>!records.some(row=>
      row.organizationId===input.organizationId && row.category===line.category &&
      row.code===line.code && row.units===line.quantity &&
      row.periodStart.getTime()===input.periodStart.getTime() &&
      row.periodEnd.getTime()===input.periodEnd.getTime()
    ))) throw new AppError(409,"SCHOOLOS_ADDON_LICENSE_REPLAY_CONFLICT","Existing license differs from signed purchase");
  }
  const metered=input.lines.filter(x=>x.category==="AI_USAGE"||x.category==="VIDEO_USAGE");
  for(const line of metered) {
    const metric=line.code;
    await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext(${"schoolos-usage:"+input.organizationId+":"+metric}))`;
    const requestKey=`paid-invoice:${input.invoiceId}:${metric}`;
    const prior=await tx.schoolOSUsageEvent.findUnique({where:{
      organizationId_metric_requestKey:{organizationId:input.organizationId,metric,requestKey},
    }});
    if(prior) {
      if(prior.sourceInvoiceId!==input.invoiceId || prior.units!==line.quantity || prior.kind!=="GRANT")
        throw new AppError(409,"SCHOOLOS_ADDON_CREDIT_REPLAY_CONFLICT","Purchased credit replay differs from original");
      continue;
    }
    const buckets=await tx.schoolOSUsageBalance.findMany({where:{
      organizationId:input.organizationId,metric,
      periodStart:{lt:input.periodEnd},periodEnd:{gt:input.periodStart},
    }});
    if(buckets.some(bucket=>bucket.periodStart.getTime()!==input.periodStart.getTime() ||
      bucket.periodEnd.getTime()!==input.periodEnd.getTime()))
      throw new AppError(409,"SCHOOLOS_ADDON_USAGE_PERIOD_OVERLAP","Existing paid usage period overlaps this invoice");
    let bucket=buckets[0];
    if(!bucket) bucket=await tx.schoolOSUsageBalance.create({data:{
      organizationId:input.organizationId,metric,periodStart:input.periodStart,periodEnd:input.periodEnd,
    }});
    const updated=await tx.schoolOSUsageBalance.updateMany({where:{
      id:bucket.id,grantedUnits:{lte:MAX_UNITS-line.quantity},
    },data:{grantedUnits:{increment:line.quantity}}});
    if(updated.count!==1) throw new AppError(409,"SCHOOLOS_ADDON_USAGE_QUOTA_OVERFLOW","Meter grant would exceed safe integer quota");
    await tx.schoolOSUsageEvent.create({data:{
      organizationId:input.organizationId,balanceId:bucket.id,metric,kind:"GRANT",
      units:line.quantity,requestKey,sourceInvoiceId:input.invoiceId,actorId:"VERIFIED_PAYMENT",
    }});
  }
  return {licensedCount:licensed.length,meteredCount:metered.length};
}
