import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { OrganizationSubscriptionStatus, SaaSBillingCycle, SaaSInvoiceStatus, SaaSPaymentStatus } from "@prisma/client";
import { systemPrisma } from "../lib/prisma.js";
import { applySchoolOSPaidAddonSettlement } from "../lib/schoolos-addon-settlement.js";
import { commercialAccessSnapshot, commercialEntitlementSnapshot } from "../lib/saas-commercial.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
function safeDb() {
  let u: URL | null=null;
  try {if(process.env.TEST_DATABASE_URL)u=new URL(process.env.TEST_DATABASE_URL);}catch { /* deny */ }
  if(!u || process.env.TEST_DATABASE_URL!==process.env.DATABASE_URL ||
     !["localhost","127.0.0.1","::1"].includes(u.hostname) ||
     !["postgres:","postgresql:"].includes(u.protocol) ||
     !/(^|[_-])(test|integration)([_-]|$)/i.test(u.pathname.replace(/^\//,"")))
    throw new Error("Refusing checkout capture test outside local isolated TEST_DATABASE_URL");
}
test("real PostgreSQL: paid captured add-ons activate exactly once, only for source tenant", {skip:!enabled,timeout:120_000},async()=>{
 safeDb();
 const id=crypto.randomUUID().slice(0,12);const orgId=`schoolos-addon-${id}`, planCode=`SOA_${id.toUpperCase()}`;
 const now=new Date("2026-10-18T12:00:00Z"),end=new Date("2027-10-18T12:00:00Z");
 let invoiceId: string | undefined,quoteId: string | undefined;
 const lines=[
   {category:"MODULE" as const,code:"lms",label:"LMS",quantity:1,unitPricePaise:2000,rateId:"rate-lms",rateRevision:1},
   {category:"CAPACITY" as const,code:"students",label:"Students",quantity:15,unitPricePaise:100,rateId:"rate-students",rateRevision:1},
   {category:"AI_USAGE" as const,code:"ai_credits",label:"AI Credits",quantity:50,unitPricePaise:100,rateId:"rate-ai",rateRevision:1},
 ];
 try {
   const plan=await systemPrisma.saaSPlan.create({data:{
     code:planCode,name:"Addon Integration Base",monthlyPricePaise:100000,annualPricePaise:4990000,
     currency:"INR",taxRateBps:1800,isActive:true,entitlements:{crm:true},limits:{students:100,users:25},
   }});
   await systemPrisma.organization.create({data:{
     id:orgId,slug:orgId,name:"Addon Integration School",email:`${orgId}@example.test`,
     subscriptionPlan:planCode,subscriptionStatus:OrganizationSubscriptionStatus.ACTIVE,
     subscriptionEndsAt:end,settings:{commercialEntitlements:{enforce:true}},
   }});
   const subscription=await systemPrisma.saaSSubscription.create({data:{
     organizationId:orgId,planId:plan.id,status:OrganizationSubscriptionStatus.ACTIVE,
     billingCycle:SaaSBillingCycle.ANNUAL,currentPeriodStart:now,currentPeriodEnd:end,
   }});
   const quote=await systemPrisma.schoolOSQuotation.create({data:{
     organizationId:orgId,quoteNo:`SOA-${id}`,clientName:"Addon QA",planCode,billingCycle:SaaSBillingCycle.ANNUAL,
     status:"PAYMENT_PENDING",validUntil:end,items:lines,pricingSnapshot:{test:true},
     subtotalPaise:4998500,discountBps:0,discountPaise:0,taxRateBps:1800,taxPaise:899730,
     totalPaise:5898230,createdBy:"qa",updatedBy:"qa",
   }});
   quoteId=quote.id;
   const invoice=await systemPrisma.saaSInvoice.create({data:{
     organizationId:orgId,subscriptionId:subscription.id,planId:plan.id,schoolOSQuoteId:quote.id,
     invoiceNo:`SOA-I-${id}`,provider:"RAZORPAY",providerOrderId:`order_${id}`,
     amountPaise:4998500,taxPaise:899730,totalPaise:5898230,currency:"INR",
     status:SaaSInvoiceStatus.OPEN,periodStart:now,periodEnd:end,
     metadata:{basis:"SIGNED_ANNUAL_BASE_PLUS_ADDONS",addonLines:lines},
   }});
   invoiceId=invoice.id;
   const input={organizationId:orgId,invoiceId:invoice.id,quoteId:quote.id,periodStart:now,periodEnd:end,totalPaise:invoice.totalPaise,lines};
   await assert.rejects(()=>systemPrisma.$transaction(tx=>applySchoolOSPaidAddonSettlement(tx,input)),
     "prepayment credits must be blocked");
   await assert.rejects(()=>systemPrisma.schoolOSAddonLicense.create({data:{
     organizationId:orgId,invoiceId:invoice.id,quoteId:quote.id,category:"MODULE",code:"lms",units:1,
     periodStart:now,periodEnd:end,
   }}),"direct SQL cannot create licenses against OPEN invoice");

   await systemPrisma.saaSInvoice.update({where:{id:invoice.id},data:{status:SaaSInvoiceStatus.PAID,paidAt:now}});
   await systemPrisma.schoolOSQuotation.update({where:{id:quote.id},data:{status:"PAID"}});
   await systemPrisma.saaSPayment.create({data:{
     organizationId:orgId,invoiceId:invoice.id,provider:"RAZORPAY",providerPaymentId:`pay_${id}`,
     amountPaise:invoice.totalPaise,currency:"INR",status:SaaSPaymentStatus.CAPTURED,capturedAt:now,
   }});
   const first=await systemPrisma.$transaction(tx=>applySchoolOSPaidAddonSettlement(tx,input));
   assert.deepEqual(first,{licensedCount:2,meteredCount:1});
   await systemPrisma.$transaction(tx=>applySchoolOSPaidAddonSettlement(tx,input));
   assert.equal(await systemPrisma.schoolOSAddonLicense.count({where:{invoiceId:invoice.id}}),2);
   assert.equal(await systemPrisma.schoolOSUsageEvent.count({where:{sourceInvoiceId:invoice.id}}),1);
   const meter=await systemPrisma.schoolOSUsageBalance.findFirstOrThrow({where:{organizationId:orgId,metric:"ai_credits"}});
   assert.equal(meter.grantedUnits,50);
   const entitlement=await commercialEntitlementSnapshot(orgId);
   assert.equal(entitlement.entitlements.lms,true);
   const access=await commercialAccessSnapshot(orgId);
   assert.equal(access.plan?.limits.students,115);

   await assert.rejects(()=>systemPrisma.schoolOSAddonLicense.create({data:{
     organizationId:"org_default",invoiceId:invoice.id,quoteId:quote.id,category:"MODULE",code:"crm",
     units:1,periodStart:now,periodEnd:end,
   }}),"cross-tenant paid license spoofing must fail at PostgreSQL");
 } finally {
   if(invoiceId) {
     await systemPrisma.schoolOSUsageEvent.deleteMany({where:{sourceInvoiceId:invoiceId}});
     await systemPrisma.schoolOSUsageBalance.deleteMany({where:{organizationId:orgId}});
     await systemPrisma.schoolOSAddonLicense.deleteMany({where:{invoiceId}});
     await systemPrisma.saaSPayment.deleteMany({where:{invoiceId}});
     await systemPrisma.saaSInvoice.deleteMany({where:{id:invoiceId}});
   }
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
