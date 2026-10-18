import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { OrganizationSubscriptionStatus, SaaSBillingCycle, SaaSInvoiceStatus, SaaSPaymentStatus } from "@prisma/client";
import { systemPrisma } from "../lib/prisma.js";
import { commercialEntitlementSnapshot } from "../lib/saas-commercial.js";
import { recordSchoolOSPaymentRisk } from "../lib/schoolos-payment-risk.js";
import { proposeSchoolOSRiskRelease, decideSchoolOSRiskRelease } from "../lib/schoolos-risk-resolution.js";

const enabled=process.env.RUN_POSTGRES_INTEGRATION==="1";
function isolatedDB() {
  let url: URL | null=null;
  try {if(process.env.TEST_DATABASE_URL)url=new URL(process.env.TEST_DATABASE_URL);}catch {/* deny */}
  if(!url || process.env.DATABASE_URL!==process.env.TEST_DATABASE_URL ||
     !["localhost","127.0.0.1","::1"].includes(url.hostname) ||
     !["postgres:","postgresql:"].includes(url.protocol) ||
     !/(^|[_-])(test|integration)([_-]|$)/i.test(url.pathname.replace(/^\//,"")))
    throw new Error("Refusing finance dispute QA outside isolated local PostgreSQL TEST_DATABASE_URL");
}

test("won dispute requires maker-checker release, signed new risk reopens and stale review is blocked", {
  skip:!enabled,timeout:120_000,
},async()=>{
  isolatedDB();
  const x=crypto.randomUUID().replaceAll("-","").slice(0,16).toUpperCase();
  const orgId=`risk-release-${x.toLowerCase()}`,planCode=`RELEASE_${x}`;
  const paymentId=`pay_${x}`,orderId=`order_${x}`,disputeId=`disp_${x}`,laterId=`disp_L${x}`;
  const from=new Date("2026-10-18T00:00:00Z"),until=new Date("2027-10-18T00:00:00Z");
  let quoteId: string | undefined,invoiceId: string | undefined;
  const eventKeys=[
    `payment.dispute.created:${disputeId}`,`payment.dispute.won:${disputeId}`,
    `payment.dispute.created:${laterId}`,`payment.dispute.won:${laterId}`,
  ];
  try{
    const plan=await systemPrisma.saaSPlan.create({data:{
      code:planCode,name:"Finance Release Test Plan",currency:"INR",
      monthlyPricePaise:100000,annualPricePaise:4990000,taxRateBps:1800,
      isActive:true,entitlements:{lms:false,crm:true},limits:{students:100},
    }});
    await systemPrisma.organization.create({data:{
      id:orgId,slug:orgId,name:"SchoolOS risk release QA",email:`${orgId}@example.test`,
      subscriptionPlan:planCode,subscriptionStatus:OrganizationSubscriptionStatus.ACTIVE,
      subscriptionEndsAt:until,settings:{commercialEntitlements:{enforce:true}},
    }});
    const sub=await systemPrisma.saaSSubscription.create({data:{
      organizationId:orgId,planId:plan.id,status:OrganizationSubscriptionStatus.ACTIVE,
      billingCycle:SaaSBillingCycle.ANNUAL,currentPeriodStart:from,currentPeriodEnd:until,
    }});
    const quote=await systemPrisma.schoolOSQuotation.create({data:{
      organizationId:orgId,quoteNo:`RELEASE-${x}`,clientName:"Refund QA",
      planCode,billingCycle:SaaSBillingCycle.ANNUAL,status:"PAID",validUntil:until,
      items:[],pricingSnapshot:{},subtotalPaise:500000,discountBps:0,discountPaise:0,
      taxRateBps:1800,taxPaise:90000,totalPaise:590000,createdBy:"qa",updatedBy:"qa",
    }});
    quoteId=quote.id;
    const invoice=await systemPrisma.saaSInvoice.create({data:{
      organizationId:orgId,subscriptionId:sub.id,planId:plan.id,schoolOSQuoteId:quote.id,
      invoiceNo:`RELEASE-I-${x}`,provider:"RAZORPAY",providerOrderId:orderId,
      status:SaaSInvoiceStatus.PAID,paidAt:from,amountPaise:500000,taxPaise:90000,
      totalPaise:590000,currency:"INR",periodStart:from,periodEnd:until,
    }});
    invoiceId=invoice.id;
    await systemPrisma.saaSPayment.create({data:{
      organizationId:orgId,invoiceId:invoice.id,provider:"RAZORPAY",
      providerPaymentId:paymentId,amountPaise:590000,currency:"INR",
      status:SaaSPaymentStatus.CAPTURED,capturedAt:from,
    }});
    await systemPrisma.schoolOSAddonLicense.create({data:{
      organizationId:orgId,invoiceId:invoice.id,quoteId:quote.id,
      category:"MODULE",code:"lms",units:1,periodStart:from,periodEnd:until,
    }});
    const created={type:"payment.dispute.created" as const,entityId:disputeId,providerPaymentId:paymentId,
      orderId:null,originalAmountPaise:590000,amountPaise:10000,currency:"INR"};
    assert.equal(await recordSchoolOSPaymentRisk(created,{event:created.type}),true);
    assert.equal((await commercialEntitlementSnapshot(orgId)).entitlements.lms,false);
    await assert.rejects(()=>proposeSchoolOSRiskRelease(invoice.id,"finance-maker",
      "FINANCE-SIGNED-DISPUTE-OUTCOME-REF","All payment dispute documentation has been verified"),
      /DISPUTE_NOT_INDEPENDENTLY_WON/);
    await recordSchoolOSPaymentRisk({...created,type:"payment.dispute.won"},{event:"payment.dispute.won"});
    let review=await proposeSchoolOSRiskRelease(invoice.id,"finance-maker",
      "FINANCE-SIGNED-DISPUTE-OUTCOME-REF","All source dispute outcomes have been independently confirmed");
    assert.equal(review.status,"PENDING");
    await assert.rejects(()=>decideSchoolOSRiskRelease(review.id,"finance-maker","APPROVE",
      "I confirm the provider has won and funds remain captured"),/cannot approve or reject own/);

    // A late signed provider event invalidates an old review even when it otherwise looks clear.
    const next={...created,entityId:laterId,type:"payment.dispute.created" as const};
    await recordSchoolOSPaymentRisk(next,{event:next.type});
    await assert.rejects(()=>decideSchoolOSRiskRelease(review.id,"finance-checker","APPROVE",
      "Independent finance review confirms original signed dispute"),
      /New provider evidence changed/);
    await recordSchoolOSPaymentRisk({...next,type:"payment.dispute.won"},{event:"payment.dispute.won"});
    review=await proposeSchoolOSRiskRelease(invoice.id,"finance-maker",
      "FINANCE-FINAL-INDEPENDENT-SIGNOFF","Both disputed amounts were confirmed won by the payment provider");
    const approved=await decideSchoolOSRiskRelease(review.id,"finance-checker","APPROVE",
      "Independently reviewed both provider outcomes and original captured payment");
    assert.equal(approved.status,"APPROVED");
    assert.equal((await systemPrisma.schoolOSPaymentRiskHold.findUniqueOrThrow({
      where:{invoiceId:invoice.id},
    })).status,"RESOLVED");
    assert.equal((await commercialEntitlementSnapshot(orgId)).entitlements.lms,true);
    assert.equal(await systemPrisma.schoolOSPaymentAdjustment.count({where:{invoiceId:invoice.id}}),4);
  } finally {
    await systemPrisma.schoolOSPaymentRiskReview.deleteMany({where:{organizationId:orgId}});
    await systemPrisma.schoolOSPaymentAdjustment.deleteMany({where:{organizationId:orgId}});
    await systemPrisma.schoolOSPaymentRiskHold.deleteMany({where:{organizationId:orgId}});
    await systemPrisma.auditLog.deleteMany({where:{organizationId:orgId,action:{in:[
      "SCHOOLOS_PAYMENT_RISK_HOLD","SCHOOLOS_RISK_RELEASE_PROPOSED",
      "SCHOOLOS_RISK_RELEASE_APPROVED","SCHOOLOS_RISK_RELEASE_REJECTED",
    ]}}});
    await systemPrisma.saaSWebhookEvent.deleteMany({where:{
      provider:"RAZORPAY",eventKey:{in:eventKeys},
    }});
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
