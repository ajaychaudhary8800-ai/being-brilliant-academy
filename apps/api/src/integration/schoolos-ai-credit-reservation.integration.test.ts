import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { OrganizationSubscriptionStatus, SaaSBillingCycle, SaaSInvoiceStatus, SaaSPaymentStatus } from "@prisma/client";
import { systemPrisma } from "../lib/prisma.js";
import { schoolOSUsageReport } from "../lib/schoolos-usage-service.js";
import { schoolOSAIReconciliationQueue } from "../lib/schoolos-ai-credit-reconciliation.js";
import { reserveSchoolOSAIExaminerCredit, commitSchoolOSAIExaminerCredit, releaseSchoolOSAIExaminerCredit } from "../lib/schoolos-ai-credit-reservations.js";

function isolatedDB() {
 let u:URL|null=null;
 try {if(process.env.TEST_DATABASE_URL)u=new URL(process.env.TEST_DATABASE_URL);}catch {/* deny */}
 if(!u||process.env.DATABASE_URL!==process.env.TEST_DATABASE_URL||
    !["localhost","127.0.0.1","::1"].includes(u.hostname)||
    !["postgres:","postgresql:"].includes(u.protocol)||
    !/(^|[_-])(test|integration)([_-]|$)/i.test(u.pathname.replace(/^\//,"")))
  throw new Error("Refusing AI credit reservation QA outside isolated local PostgreSQL test DB");
}

test("paid AI reservations enforce tenant source, exactly-once billing and conclusive releases",{
 skip:process.env.RUN_POSTGRES_INTEGRATION!=="1",timeout:120_000,
},async()=>{
 isolatedDB();
 const token=crypto.randomUUID().replaceAll("-","").slice(0,14);
 const orgId="ai-reserve-"+token,code="AI_RES_"+token.toUpperCase();
 const now=new Date("2026-10-19T12:00:00Z");
 const from=new Date("2026-10-01T00:00:00Z"),end=new Date("2026-11-01T00:00:00Z");
 let invoiceId="",quoteId="";
 try {
  const plan=await systemPrisma.saaSPlan.create({data:{
   code,name:"AI Credit Test",currency:"INR",monthlyPricePaise:100000,
   annualPricePaise:4990000,taxRateBps:1800,isActive:true,
   entitlements:{lms:true},limits:{students:100},
  }});
  await systemPrisma.organization.create({data:{
   id:orgId,slug:orgId,name:"AI Credit Integration QA",email:orgId+"@example.test",
   subscriptionPlan:code,subscriptionStatus:OrganizationSubscriptionStatus.ACTIVE,
   subscriptionEndsAt:end,
  }});
  const sub=await systemPrisma.saaSSubscription.create({data:{
   organizationId:orgId,planId:plan.id,status:OrganizationSubscriptionStatus.ACTIVE,
   billingCycle:SaaSBillingCycle.ANNUAL,currentPeriodStart:from,currentPeriodEnd:end,
  }});
  const quote=await systemPrisma.schoolOSQuotation.create({data:{
   organizationId:orgId,quoteNo:"AI-RES-"+token,clientName:"AI QA",
   planCode:code,billingCycle:SaaSBillingCycle.ANNUAL,status:"PAID",validUntil:end,
   items:[],pricingSnapshot:{},subtotalPaise:100000,discountBps:0,discountPaise:0,
   taxRateBps:1800,taxPaise:18000,totalPaise:118000,
   createdBy:"qa",updatedBy:"qa",
  }});
  quoteId=quote.id;
  const invoice=await systemPrisma.saaSInvoice.create({data:{
   organizationId:orgId,subscriptionId:sub.id,planId:plan.id,
   schoolOSQuoteId:quoteId,invoiceNo:"AI-INV-"+token,status:SaaSInvoiceStatus.PAID,
   amountPaise:100000,taxPaise:18000,totalPaise:118000,currency:"INR",
   periodStart:from,periodEnd:end,paidAt:from,provider:"RAZORPAY",
   providerOrderId:"order_"+token,
  }});
  invoiceId=invoice.id;
  await systemPrisma.saaSPayment.create({data:{
   organizationId:orgId,invoiceId,provider:"RAZORPAY",
   providerPaymentId:"pay_"+token,status:SaaSPaymentStatus.CAPTURED,
   amountPaise:118000,currency:"INR",capturedAt:from,
  }});
  const balance=await systemPrisma.schoolOSUsageBalance.create({data:{
   organizationId:orgId,metric:"ai_credits",periodStart:from,periodEnd:end,
   grantedUnits:2,consumedUnits:0,
  }});
  await systemPrisma.schoolOSUsageEvent.create({data:{
   organizationId:orgId,balanceId:balance.id,metric:"ai_credits",
   kind:"GRANT",units:2,requestKey:"paid-invoice:"+invoiceId+":ai_credits",
   sourceInvoiceId:invoiceId,actorId:"VERIFIED_PAYMENT",
  }});
  await assert.rejects(()=>systemPrisma.schoolOSUsageReservation.create({data:{
   organizationId:"org_default",balanceId:balance.id,metric:"ai_credits",
   requestKey:"ai-examiner:foreign",units:1,status:"RESERVED",
  }}),"DB trigger rejects cross-tenant reservations");

  const a=await reserveSchoolOSAIExaminerCredit(orgId,"evaluation-A",null,now);
  assert.equal(a.admitted,true);
  const report=await schoolOSUsageReport(orgId);
  assert.equal(report.pendingAIReservations.count,1);
  assert.equal(report.pendingAIReservations.units,1);
  assert.equal(report.balances.find(row=>row.metric==="ai_credits")?.pendingReservationUnits,1);
  assert.equal(report.balances.find(row=>row.metric==="ai_credits")?.remainingUnits,1);
  const replay=await reserveSchoolOSAIExaminerCredit(orgId,"evaluation-A",null,now);
  assert.equal(replay.admitted,false);
  assert.equal(replay.status,"RESERVED");

  const race=await Promise.allSettled([
   reserveSchoolOSAIExaminerCredit(orgId,"evaluation-B",null,now),
   reserveSchoolOSAIExaminerCredit(orgId,"evaluation-C",null,now),
  ]);
  assert.equal(race.filter(x=>x.status==="fulfilled").length,1);
  assert.equal(race.filter(x=>x.status==="rejected").length,1);
  const winner=race[0]?.status==="fulfilled"?"evaluation-B":"evaluation-C";
  assert.equal((await systemPrisma.schoolOSUsageBalance.findUniqueOrThrow({
   where:{id:balance.id}})).consumedUnits,2);

  // No authoritative persisted evaluation exists, so even a platform reviewer
  // cannot convert a merely RESERVED credit into an invoiced debit.
  const queue=await schoolOSAIReconciliationQueue(orgId);
  assert.equal(queue.total,2);
  assert.equal(queue.items.every(item=>item.commitEligible===false),true);
  assert.equal(queue.items.every(item=>item.automaticReleaseAllowed===false),true);
  await assert.rejects(()=>commitSchoolOSAIExaminerCredit(orgId,winner,{
   actorId:"platform-reviewer",
   evidenceReference:"external-provider-reference-example",
   reviewComment:"Independent validation requested but durable result missing",
  }),/persisted AI evaluation results/);
  assert.equal((await systemPrisma.schoolOSUsageBalance.findUniqueOrThrow({
   where:{id:balance.id}})).consumedUnits,2);
  assert.equal(await systemPrisma.schoolOSUsageEvent.count({
   where:{organizationId:orgId,kind:"CONSUME"}}),0);

  const committed=await commitSchoolOSAIExaminerCredit(orgId,winner);
  assert.equal(committed.committed,true);
  assert.equal((await commitSchoolOSAIExaminerCredit(orgId,winner)).committed,false);
  assert.equal(await systemPrisma.schoolOSUsageEvent.count({where:{
   organizationId:orgId,kind:"CONSUME"}}),1);
  await assert.rejects(()=>releaseSchoolOSAIExaminerCredit(orgId,winner,
   "Provider confirmed evaluation complete"),/cannot be reversed/);

  assert.equal((await releaseSchoolOSAIExaminerCredit(orgId,"evaluation-A",
   "Provider request definitely never sent")).released,true);
  assert.equal((await releaseSchoolOSAIExaminerCredit(orgId,"evaluation-A",
   "Provider request definitely never sent")).released,false);
  assert.equal((await systemPrisma.schoolOSUsageBalance.findUniqueOrThrow({
   where:{id:balance.id}})).consumedUnits,1);

  const d=await reserveSchoolOSAIExaminerCredit(orgId,"evaluation-D",null,now);
  assert.equal(d.admitted,true);
  await systemPrisma.schoolOSPaymentRiskHold.create({data:{
   organizationId:orgId,invoiceId,status:"ACTIVE",
   firstEventType:"payment.dispute.created",latestEventType:"payment.dispute.created",
   firstEventKey:"payment.dispute.created:"+token,
   latestEventKey:"payment.dispute.created:"+token,
  }});
  await assert.rejects(()=>commitSchoolOSAIExaminerCredit(orgId,"evaluation-D"),/finance reconciliation/);
  await assert.rejects(()=>reserveSchoolOSAIExaminerCredit(orgId,"evaluation-E",null,now),/Finance review/);
  await systemPrisma.schoolOSPaymentRiskHold.deleteMany({where:{organizationId:orgId}});
  assert.equal((await commitSchoolOSAIExaminerCredit(orgId,"evaluation-D")).committed,true);
  assert.equal((await systemPrisma.schoolOSUsageBalance.findUniqueOrThrow({
   where:{id:balance.id}})).consumedUnits,2);
 } finally {
  await systemPrisma.schoolOSPaymentRiskHold.deleteMany({where:{organizationId:orgId}});
  await systemPrisma.schoolOSUsageReservation.deleteMany({where:{organizationId:orgId}});
  await systemPrisma.schoolOSUsageEvent.deleteMany({where:{organizationId:orgId}});
  await systemPrisma.schoolOSUsageBalance.deleteMany({where:{organizationId:orgId}});
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
  await systemPrisma.saaSPlan.deleteMany({where:{code}});
 }
});
