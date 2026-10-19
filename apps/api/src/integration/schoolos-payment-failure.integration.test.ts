import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { OrganizationSubscriptionStatus, SaaSBillingCycle, SaaSInvoiceStatus, SaaSPaymentStatus } from "@prisma/client";
import { systemPrisma } from "../lib/prisma.js";
import { recordSchoolOSFailedPayment } from "../lib/schoolos-payment-failure.js";

function isolatedDB() {
  let url: URL | null=null;
  try {if(process.env.TEST_DATABASE_URL)url=new URL(process.env.TEST_DATABASE_URL);}catch { /* deny */ }
  if(!url || process.env.DATABASE_URL!==process.env.TEST_DATABASE_URL ||
    !["localhost","127.0.0.1","::1"].includes(url.hostname) ||
    !["postgres:","postgresql:"].includes(url.protocol) ||
    !/(^|[_-])(test|integration)([_-]|$)/i.test(url.pathname.replace(/^\//,"")))
    throw new Error("Refusing signed payment recovery QA outside isolated local PostgreSQL TEST_DATABASE_URL");
}

test("signed SchoolOS payment failures are idempotent, paid-state safe and isolated",{
  skip:process.env.RUN_POSTGRES_INTEGRATION!=="1",timeout:120_000,
},async()=>{
  isolatedDB();
  const token=crypto.randomUUID().replaceAll("-","").slice(0,16);
  const orgId="failed-pay-"+token,planCode="FAILED_"+token.toUpperCase();
  const orderId="order_"+token,paymentId="pay_"+token;
  const from=new Date("2026-10-19T00:00:00.000Z");
  const end=new Date("2027-10-19T00:00:00.000Z");
  let invoiceId="",quoteId="";
  try {
    const plan=await systemPrisma.saaSPlan.create({data:{
      code:planCode,name:"Payment recovery test",currency:"INR",
      monthlyPricePaise:100000,annualPricePaise:4990000,taxRateBps:1800,
      entitlements:{lms:true},limits:{students:100},isActive:true,
    }});
    await systemPrisma.organization.create({data:{
      id:orgId,slug:orgId,name:"SchoolOS failure QA",email:orgId+"@example.test",
      subscriptionPlan:planCode,subscriptionStatus:OrganizationSubscriptionStatus.ACTIVE,
      subscriptionEndsAt:end,
    }});
    const subscription=await systemPrisma.saaSSubscription.create({data:{
      organizationId:orgId,planId:plan.id,status:OrganizationSubscriptionStatus.ACTIVE,
      billingCycle:SaaSBillingCycle.ANNUAL,currentPeriodStart:from,currentPeriodEnd:end,
    }});
    const quote=await systemPrisma.schoolOSQuotation.create({data:{
      organizationId:orgId,quoteNo:"FAIL-"+token,clientName:"Signed source QA",
      planCode,billingCycle:SaaSBillingCycle.ANNUAL,status:"PAYMENT_PENDING",
      validUntil:end,items:[],pricingSnapshot:{},
      subtotalPaise:500000,discountBps:0,discountPaise:0,taxRateBps:1800,
      taxPaise:90000,totalPaise:590000,createdBy:"qa",updatedBy:"qa",
    }});
    quoteId=quote.id;
    const invoice=await systemPrisma.saaSInvoice.create({data:{
      organizationId:orgId,subscriptionId:subscription.id,planId:plan.id,
      schoolOSQuoteId:quote.id,invoiceNo:"FAIL-I-"+token,
      status:SaaSInvoiceStatus.OPEN,provider:"RAZORPAY",providerOrderId:orderId,
      amountPaise:500000,taxPaise:90000,totalPaise:590000,currency:"INR",
      periodStart:from,periodEnd:end,dueAt:new Date("2026-10-20T00:00:00.000Z"),
    }});
    invoiceId=invoice.id;
    const evidence={providerPaymentId:paymentId,orderId,amountPaise:590000,
      currency:"INR",errorCode:"BAD_PAYMENT"};
    assert.equal(await recordSchoolOSFailedPayment(evidence),true);
    assert.equal(await recordSchoolOSFailedPayment(evidence),true);
    await assert.rejects(()=>recordSchoolOSFailedPayment({...evidence,amountPaise:590001}),
      /does not match|mismatch/i);
    await assert.rejects(()=>recordSchoolOSFailedPayment({...evidence,errorCode:"CHANGED"}),
      /conflicting evidence/);
    assert.equal(await systemPrisma.saaSPayment.count({where:{
      organizationId:orgId,invoiceId,status:SaaSPaymentStatus.FAILED,
    }}),1);
    assert.equal(await systemPrisma.saaSWebhookEvent.count({where:{
      provider:"RAZORPAY",eventKey:"payment.failed:"+paymentId,
    }}),1);
    assert.equal((await systemPrisma.saaSInvoice.findUniqueOrThrow({where:{id:invoiceId}})).status,
      SaaSInvoiceStatus.OPEN);
    assert.equal((await systemPrisma.schoolOSQuotation.findUniqueOrThrow({where:{id:quoteId}})).status,
      "PAYMENT_PENDING");

    await systemPrisma.saaSInvoice.update({where:{id:invoiceId},data:{
      status:SaaSInvoiceStatus.PAID,paidAt:new Date(),
    }});
    const late="pay_late"+token;
    assert.equal(await recordSchoolOSFailedPayment({
      ...evidence,providerPaymentId:late,
    }),true);
    assert.equal(await systemPrisma.saaSPayment.count({where:{
      organizationId:orgId,invoiceId,status:SaaSPaymentStatus.FAILED,
    }}),1); // Late failure did not change the captured paid invoice.
    assert.equal((await systemPrisma.saaSInvoice.findUniqueOrThrow({where:{id:invoiceId}})).status,
      SaaSInvoiceStatus.PAID);
  } finally {
    await systemPrisma.saaSWebhookEvent.deleteMany({where:{
      provider:"RAZORPAY",eventKey:{in:[
        "payment.failed:"+paymentId,"payment.failed:pay_late"+token,
      ]},
    }});
    await systemPrisma.auditLog.deleteMany({where:{organizationId:orgId}});
    await systemPrisma.saaSPayment.deleteMany({where:{organizationId:orgId}});
    await systemPrisma.saaSInvoice.deleteMany({where:{organizationId:orgId}});
    await systemPrisma.schoolOSQuotation.deleteMany({where:{organizationId:orgId}});
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
