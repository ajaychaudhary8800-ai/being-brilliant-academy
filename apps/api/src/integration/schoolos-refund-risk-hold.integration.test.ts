import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  OrganizationSubscriptionStatus, SaaSBillingCycle, SaaSInvoiceStatus, SaaSPaymentStatus,
} from "@prisma/client";
import { systemPrisma } from "../lib/prisma.js";
import { recordSchoolOSPaymentRisk } from "../lib/schoolos-payment-risk.js";
import { commercialEntitlementSnapshot } from "../lib/saas-commercial.js";
import { consumeSchoolOSUsage } from "../lib/schoolos-usage-service.js";

const enabled=process.env.RUN_POSTGRES_INTEGRATION==="1";
function isolatedDB() {
  let url:URL|undefined;
  try {if(process.env.TEST_DATABASE_URL)url=new URL(process.env.TEST_DATABASE_URL);}catch { /* deny */ }
  if(!url || process.env.DATABASE_URL!==process.env.TEST_DATABASE_URL ||
     !["localhost","127.0.0.1","::1"].includes(url.hostname) ||
     !["postgres:","postgresql:"].includes(url.protocol) ||
     !/(^|[_-])(test|integration)([_-]|$)/i.test(url.pathname.replace(/^\//,"")))
    throw new Error("Refusing payment-risk test without isolated local test PostgreSQL");
}
test("processed partial refund suspends paid modules and AI credits with durable replay protection", {
  skip:!enabled,timeout:120_000,
},async()=>{
  isolatedDB();
  const suffix=crypto.randomUUID().replaceAll("-","").slice(0,16).toUpperCase();
  const orgId=`risk-test-${suffix.toLowerCase()}`,planCode=`RISK_${suffix}`;
  const paymentId=`pay_${suffix}`,orderId=`order_${suffix}`,refundId=`rfnd_${suffix}`,disputeId=`disp_${suffix}`;
  const start=new Date("2026-10-18T00:00:00Z"),end=new Date("2027-10-18T00:00:00Z");
  let invoiceId: string|undefined,quoteId:string|undefined;
  const eventKeys=[`refund.processed:${refundId}`,`payment.dispute.created:${disputeId}`];
  try {
    const plan=await systemPrisma.saaSPlan.create({data:{
      code:planCode,name:"Risk Test Plan",monthlyPricePaise:100000,
      annualPricePaise:4990000,taxRateBps:1800,currency:"INR",
      isActive:true,entitlements:{crm:true,lms:false},limits:{students:100},
    }});
    await systemPrisma.organization.create({data:{
      id:orgId,slug:orgId,name:"Refund Risk QA",email:`${orgId}@example.test`,
      subscriptionPlan:planCode,subscriptionStatus:OrganizationSubscriptionStatus.ACTIVE,
      subscriptionEndsAt:end,settings:{commercialEntitlements:{enforce:true}},
    }});
    const sub=await systemPrisma.saaSSubscription.create({data:{
      organizationId:orgId,planId:plan.id,status:OrganizationSubscriptionStatus.ACTIVE,
      billingCycle:SaaSBillingCycle.ANNUAL,currentPeriodStart:start,currentPeriodEnd:end,
    }});
    const quote=await systemPrisma.schoolOSQuotation.create({data:{
      organizationId:orgId,quoteNo:`RISK-${suffix}`,clientName:"Refund QA",
      planCode,billingCycle:SaaSBillingCycle.ANNUAL,status:"PAID",
      validUntil:end,items:[],pricingSnapshot:{},
      subtotalPaise:500000,discountBps:0,discountPaise:0,
      taxRateBps:1800,taxPaise:90000,totalPaise:590000,createdBy:"qa",updatedBy:"qa",
    }});
    quoteId=quote.id;
    const invoice=await systemPrisma.saaSInvoice.create({data:{
      organizationId:orgId,subscriptionId:sub.id,planId:plan.id,schoolOSQuoteId:quote.id,
      invoiceNo:`RISK-I-${suffix}`,provider:"RAZORPAY",providerOrderId:orderId,
      status:SaaSInvoiceStatus.PAID,paidAt:start,amountPaise:500000,taxPaise:90000,
      totalPaise:590000,currency:"INR",periodStart:start,periodEnd:end,
    }});
    invoiceId=invoice.id;
    await systemPrisma.saaSPayment.create({data:{
      organizationId:orgId,invoiceId:invoice.id,provider:"RAZORPAY",
      providerPaymentId:paymentId,amountPaise:590000,currency:"INR",
      status:SaaSPaymentStatus.CAPTURED,capturedAt:start,
    }});
    await systemPrisma.schoolOSAddonLicense.create({data:{
      organizationId:orgId,invoiceId:invoice.id,quoteId:quote.id,
      category:"MODULE",code:"lms",units:1,periodStart:start,periodEnd:end,
    }});
    const balance=await systemPrisma.schoolOSUsageBalance.create({data:{
      organizationId:orgId,metric:"ai_credits",periodStart:start,periodEnd:end,grantedUnits:10,
    }});
    await systemPrisma.schoolOSUsageEvent.create({data:{
      organizationId:orgId,balanceId:balance.id,metric:"ai_credits",kind:"GRANT",
      units:10,requestKey:`paid-invoice:${invoice.id}:ai_credits`,sourceInvoiceId:invoice.id,
    }});
    assert.equal((await commercialEntitlementSnapshot(orgId)).entitlements.lms,true);
    assert.equal((await consumeSchoolOSUsage(orgId,"ai_credits",2,`exam:${suffix}:pre`,null,new Date("2026-10-20"))).charged,true);
    const event={type:"refund.processed" as const,entityId:refundId,providerPaymentId:paymentId,
      orderId,originalAmountPaise:590000,amountPaise:10000,currency:"INR"};
    assert.equal(await recordSchoolOSPaymentRisk(event,{event:"refund.processed",amount:10000}),true);
    assert.equal(await recordSchoolOSPaymentRisk(event,{event:"refund.processed",amount:10000}),true);
    assert.equal(await systemPrisma.schoolOSPaymentAdjustment.count({where:{invoiceId:invoice.id}}),1);
    assert.equal(await systemPrisma.schoolOSPaymentRiskHold.count({where:{invoiceId:invoice.id,status:"ACTIVE"}}),1);
    assert.equal((await commercialEntitlementSnapshot(orgId)).entitlements.lms,false);
    await assert.rejects(()=>consumeSchoolOSUsage(orgId,"ai_credits",1,`exam:${suffix}:after`,null,new Date("2026-10-20")),
      /suspended pending financial review/);
    const remaining=await systemPrisma.schoolOSUsageBalance.findUniqueOrThrow({where:{id:balance.id}});
    assert.equal(remaining.consumedUnits,2);
    await assert.rejects(()=>recordSchoolOSPaymentRisk({...event,amountPaise:20000},{event:"refund.processed"}),
      /reused with changed details/);
    const dispute={...event,type:"payment.dispute.created" as const,entityId:disputeId,amountPaise:50000};
    await recordSchoolOSPaymentRisk(dispute,{event:"payment.dispute.created"});
    assert.equal(await systemPrisma.schoolOSPaymentAdjustment.count({where:{invoiceId:invoice.id}}),2);
    await assert.rejects(()=>recordSchoolOSPaymentRisk({...event,providerPaymentId:"pay_WRONG"},
      {event:"refund.processed"}),/(captured payment found|original captured SaaS invoice)/);
    const hold=await systemPrisma.schoolOSPaymentRiskHold.findUniqueOrThrow({where:{invoiceId:invoice.id}});
    assert.equal(hold.latestEventType,"payment.dispute.created");
    // Base subscription remains intact pending independent finance reconciliation.
    assert.equal((await systemPrisma.organization.findUniqueOrThrow({where:{id:orgId}})).subscriptionStatus,
      OrganizationSubscriptionStatus.ACTIVE);
  } finally {
    await systemPrisma.auditLog.deleteMany({where:{organizationId:orgId,action:"SCHOOLOS_PAYMENT_RISK_HOLD"}});
    await systemPrisma.schoolOSPaymentAdjustment.deleteMany({where:{organizationId:orgId}});
    await systemPrisma.schoolOSPaymentRiskHold.deleteMany({where:{organizationId:orgId}});
    await systemPrisma.saaSWebhookEvent.deleteMany({where:{
      provider:"RAZORPAY",eventKey:{in:eventKeys},
    }});
    await systemPrisma.schoolOSUsageEvent.deleteMany({where:{organizationId:orgId}});
    await systemPrisma.schoolOSUsageBalance.deleteMany({where:{organizationId:orgId}});
    await systemPrisma.schoolOSAddonLicense.deleteMany({where:{organizationId:orgId}});
    if(invoiceId)await systemPrisma.saaSPayment.deleteMany({where:{invoiceId}});
    if(invoiceId)await systemPrisma.saaSInvoice.deleteMany({where:{id:invoiceId}});
    if(quoteId)await systemPrisma.schoolOSQuotation.deleteMany({where:{id:quoteId}});
    await systemPrisma.saaSSubscription.deleteMany({where:{organizationId:orgId}});
    await systemPrisma.$transaction(async tx=>{
      await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" DISABLE TRIGGER "AcademicSession_exactly_one_current"');
      await tx.academicSession.deleteMany({where:{organizationId:orgId}});
      await tx.organization.deleteMany({where:{id:orgId}});
      await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" ENABLE TRIGGER "AcademicSession_exactly_one_current"');
    });
    await systemPrisma.saaSPlan.deleteMany({where:{code:planCode}});
  }
});
