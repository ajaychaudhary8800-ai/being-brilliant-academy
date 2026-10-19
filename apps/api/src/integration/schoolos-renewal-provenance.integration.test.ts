import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { OrganizationSubscriptionStatus, SaaSBillingCycle, SaaSInvoiceStatus } from "@prisma/client";
import { systemPrisma } from "../lib/prisma.js";
import { assertSchoolOSRenewalSource } from "../lib/schoolos-renewal-quote-policy.js";

function assertIsolatedPostgres() {
  let url: URL | undefined;
  try { if (process.env.TEST_DATABASE_URL) url = new URL(process.env.TEST_DATABASE_URL); }
  catch { /* fail closed */ }
  if (!url || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL ||
    !["localhost","127.0.0.1","::1"].includes(url.hostname) ||
    !["postgres:","postgresql:"].includes(url.protocol) ||
    !/(^|[_-])(test|integration)([_-]|$)/i.test(url.pathname.replace(/^\//,"")))
    throw new Error("Refusing renewal PostgreSQL QA outside isolated local integration database");
}

test("renewal provenance uses real PAID invoices, strict tenant ownership, newest term and hold state", {
  skip: process.env.RUN_POSTGRES_INTEGRATION !== "1", timeout: 120_000,
}, async () => {
  assertIsolatedPostgres();
  const tag=crypto.randomUUID().replaceAll("-","").slice(0,15);
  const organizationId="renewal-origin-"+tag;
  const planCode="RENEWAL_"+tag.toUpperCase();
  const from=new Date("2025-01-01T00:00:00.000Z");
  const middle=new Date("2026-01-01T00:00:00.000Z");
  const end=new Date("2027-01-01T00:00:00.000Z");
  const createdIds: string[]=[];
  const quoteIds: string[]=[];
  try {
    const plan=await systemPrisma.saaSPlan.create({data:{
      code:planCode,name:"Renewal source QA",monthlyPricePaise:100000,
      annualPricePaise:4990000,taxRateBps:1800,currency:"INR",
      isActive:true,entitlements:{lms:true},limits:{students:100},
    }});
    await systemPrisma.organization.create({data:{
      id:organizationId,slug:organizationId,name:"SchoolOS renewal QA",
      email:organizationId+"@example.test",subscriptionPlan:planCode,
      subscriptionStatus:OrganizationSubscriptionStatus.ACTIVE,subscriptionEndsAt:end,
    }});
    const sub=await systemPrisma.saaSSubscription.create({data:{
      organizationId,planId:plan.id,status:OrganizationSubscriptionStatus.ACTIVE,
      billingCycle:SaaSBillingCycle.ANNUAL,currentPeriodStart:middle,currentPeriodEnd:end,
    }});
    for (const [index,start,finish] of [[1,from,middle],[2,middle,end]] as const) {
      const quote=await systemPrisma.schoolOSQuotation.create({data:{
        organizationId,quoteNo:`RENEW-${tag}-${index}`,clientName:"Renewal QA",
        planCode,billingCycle:SaaSBillingCycle.ANNUAL,status:"PAID",validUntil:end,
        items:[],pricingSnapshot:{},subtotalPaise:100000,discountBps:0,discountPaise:0,
        taxRateBps:1800,taxPaise:18000,totalPaise:118000,createdBy:"qa",updatedBy:"qa",
      }});
      quoteIds.push(quote.id);
      const invoice=await systemPrisma.saaSInvoice.create({data:{
        organizationId,subscriptionId:sub.id,planId:plan.id,schoolOSQuoteId:quote.id,
        invoiceNo:`RENEW-I-${tag}-${index}`,status:SaaSInvoiceStatus.PAID,
        amountPaise:100000,taxPaise:18000,totalPaise:118000,currency:"INR",
        periodStart:start,periodEnd:finish,paidAt:start,
      }});
      createdIds.push(invoice.id);
    }
    const latestPaid=await systemPrisma.saaSInvoice.findFirst({
      where:{organizationId,status:SaaSInvoiceStatus.PAID},
      orderBy:[{periodEnd:"desc"},{createdAt:"desc"}],select:{id:true},
    });
    const newer=await systemPrisma.saaSInvoice.findUniqueOrThrow({where:{id:createdIds[1]},
      select:{id:true,organizationId:true,status:true,schoolOSQuoteId:true,periodEnd:true,
        schoolOSPaymentRiskHold:{select:{status:true}}},
    });
    const older=await systemPrisma.saaSInvoice.findUniqueOrThrow({where:{id:createdIds[0]},
      select:{id:true,organizationId:true,status:true,schoolOSQuoteId:true,periodEnd:true,
        schoolOSPaymentRiskHold:{select:{status:true}}},
    });
    assert.equal(assertSchoolOSRenewalSource(newer,organizationId,latestPaid?.id??null).sourceInvoiceId,newer.id);
    assert.throws(()=>assertSchoolOSRenewalSource(older,organizationId,latestPaid?.id??null),/Latest verified/);
    assert.throws(()=>assertSchoolOSRenewalSource(newer,"foreign-tenant",latestPaid?.id??null),/Previous paid/);
    await systemPrisma.schoolOSPaymentRiskHold.create({data:{
      invoiceId:newer.id,organizationId,status:"ACTIVE",
      firstEventType:"payment.dispute.created",latestEventType:"payment.dispute.created",
      firstEventKey:"payment.dispute.created:renew-"+tag,
      latestEventKey:"payment.dispute.created:renew-"+tag,
    }});
    const held=await systemPrisma.saaSInvoice.findUniqueOrThrow({where:{id:newer.id},
      select:{id:true,organizationId:true,status:true,schoolOSQuoteId:true,periodEnd:true,
        schoolOSPaymentRiskHold:{select:{status:true}}},
    });
    assert.throws(()=>assertSchoolOSRenewalSource(held,organizationId,latestPaid?.id??null),/payment risk/);
  } finally {
    await systemPrisma.schoolOSPaymentRiskHold.deleteMany({where:{organizationId}});
    await systemPrisma.saaSInvoice.deleteMany({where:{organizationId}});
    await systemPrisma.schoolOSQuotation.deleteMany({where:{id:{in:quoteIds}}});
    await systemPrisma.saaSSubscription.deleteMany({where:{organizationId}});
    // Organization creation provisioned an academic session. The invariant trigger
    // requires the same isolated-test transactional cleanup used by existing suites.
    await systemPrisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" DISABLE TRIGGER "AcademicSession_exactly_one_current"');
      await tx.academicSession.deleteMany({where:{organizationId}});
      await tx.organization.deleteMany({where:{id:organizationId}});
      await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" ENABLE TRIGGER "AcademicSession_exactly_one_current"');
    });
    await systemPrisma.saaSPlan.deleteMany({where:{code:planCode}});
  }
});
