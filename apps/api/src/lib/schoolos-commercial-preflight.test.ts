import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assessSchoolOSCommercialPreflight } from "./schoolos-commercial-preflight.js";
import type { StagingPlanSnapshot } from "./schoolos-staging-pricebook-policy.js";

const plans = (): StagingPlanSnapshot[] => [
  { id:"e",code:"ESSENTIALS", annualPricePaise:4_999_000, currency:"INR",
    taxRateBps:1800,isActive:true,existingQuotes:0,paidInvoices:0,outstandingInvoices:0 },
  { id:"g",code:"GROWTH", annualPricePaise:8_999_000, currency:"INR",
    taxRateBps:1800,isActive:true,existingQuotes:0,paidInvoices:0,outstandingInvoices:0 },
  { id:"p",code:"PROFESSIONAL", annualPricePaise:14_999_000, currency:"INR",
    taxRateBps:1800,isActive:true,existingQuotes:1,paidInvoices:1,outstandingInvoices:0 },
  { id:"x",code:"ENTERPRISE", annualPricePaise:29_999_000, currency:"INR",
    taxRateBps:1800,isActive:true,existingQuotes:0,paidInvoices:0,outstandingInvoices:0 },
];
const env = {
  RAZORPAY_MODE:"test",RAZORPAY_KEY_ID:"rzp_test_PRIVATE_KEY_ID",
  RAZORPAY_KEY_SECRET:"SENSITIVE_SECRET_VALUE",RAZORPAY_WEBHOOK_SECRET:"WEBHOOK_PRIVATE_SECRET",
  SMTP_HOST:"smtp.private.example",SMTP_USER:"private-person@example.org",
  SMTP_PASSWORD:"SMTP_PRIVATE_SECRET",EMAIL_FROM:"billing.private@example.org",
  LIVEKIT_URL:"wss://hidden.private.example",LIVEKIT_API_KEY:"VIDEO_PRIVATE_KEY",
  LIVEKIT_API_SECRET:"VIDEO_PRIVATE_SECRET",
  SCHOOLOS_VIDEO_ADMISSION_ENABLED:"false",
};

test("historical Professional payment is retained as ALIGNED while drifted Essentials/Growth remain blocked for paid checkout",()=>{
  const p=plans(), report=assessSchoolOSCommercialPreflight(p,p,env);
  assert.deepEqual(report.fixedPriceActions.map(x=>x.status),["CHANGE_SAFE","CHANGE_SAFE","ALIGNED"]);
  assert.equal(report.priceBookAligned,false);
  assert.equal(report.providerChecks.razorpayTestCredentialsPresent,true);
  assert.equal(report.providerChecks.smtpCredentialsPresent,true);
  assert.equal(report.providerChecks.liveKitCredentialsPresent,true);
  assert.equal(report.paidLaunchAuthorized,false);
  assert.equal(report.actualPaymentsCreated,false);
  assert.equal(report.fixedPriceActions[2]?.paidInvoices,1);
});
test("even perfect catalogue plus provider credential presence does not self-authorize paid launch",()=>{
  const p=plans().map(x=>({ ...x,
    annualPricePaise:x.code==="ESSENTIALS"?4_990_000:x.code==="GROWTH"?9_990_000:x.annualPricePaise }));
  const report=assessSchoolOSCommercialPreflight(p,p,env);
  assert.equal(report.priceBookAligned,true);
  assert.equal(report.paidLaunchAuthorized,false);
  assert.equal(report.providerConnectivityTested,false);
  assert.equal(report.commercialReleaseVerified,false);
  assert.equal(report.launchBlockers.includes("INDEPENDENT_RELEASE_GATES_AND_OWNER_APPROVAL_REQUIRED"),true);
  assert.equal(report.enterprisePricing?.status,"CUSTOM_QUOTE_REQUIRED");
});
test("configuration status never exposes environment secrets, key IDs, addresses or tenant IDs",()=>{
  const report=assessSchoolOSCommercialPreflight(plans(),plans(),{
    ...env,SCHOOLOS_VIDEO_ADMISSION_ENABLED:"true",
    SCHOOLOS_VIDEO_ADMISSION_TENANT_IDS:"SECRET_TENANT_ID",
  });
  const output=JSON.stringify(report);
  for(const sensitive of [env.RAZORPAY_KEY_ID,env.RAZORPAY_KEY_SECRET,env.RAZORPAY_WEBHOOK_SECRET,
    env.SMTP_HOST,env.SMTP_USER,env.SMTP_PASSWORD,env.EMAIL_FROM,
    env.LIVEKIT_URL,env.LIVEKIT_API_KEY,env.LIVEKIT_API_SECRET,"SECRET_TENANT_ID"]) {
    assert.ok(sensitive && !output.includes(sensitive),"Private configuration leaked into report");
  }
  assert.equal(report.providerChecks.videoPaidAdmissionEnabled,true);
});
test("missing enterprise tier, unapproved GST and incomplete providers block catalogue confidence",()=>{
  const p=plans().filter(x=>x.code!=="ENTERPRISE").map(x=>({ ...x,
    annualPricePaise:x.code==="ESSENTIALS"?4_990_000:x.code==="GROWTH"?9_990_000:x.annualPricePaise }));
  const report=assessSchoolOSCommercialPreflight(p,p,{RAZORPAY_MODE:"live"});
  assert.equal(report.priceBookAligned,false);
  assert.equal(report.providerChecks.razorpayTestCredentialsPresent,false);
  assert.equal(report.launchBlockers.includes("CATALOGUE_FINANCE_RECONCILIATION"),true);
});
test("staging preflight has no mutation or provider API calls",async()=>{
  const script=await readFile(new URL("../scripts/schoolos-v5-commercial-preflight.ts",import.meta.url),"utf8");
  assert.match(script,/assertV5StagingPricebookTarget\(process\.env, false\)/);
  assert.match(script,/RepeatableRead/);
  assert.doesNotMatch(script,/\b(?:create|update|delete|upsert|executeRaw|fetch)\s*\(/);
  assert.doesNotMatch(script,/--apply/);
});
