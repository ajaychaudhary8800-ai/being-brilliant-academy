import assert from "node:assert/strict";
import test from "node:test";
import { validateSchoolOSAddonCheckout } from "./schoolos-addon-checkout-policy.js";
import { calculateSchoolOSQuote } from "./schoolos-quotation.js";
import type { SchoolOSAddonRate } from "./schoolos-addon-pricing-policy.js";
const now=new Date("2026-10-20T12:00:00Z");
const plan={id:"growth-id",code:"GROWTH",annualPricePaise:9990000,taxRateBps:1800,currency:"INR",isActive:true};
const rate: SchoolOSAddonRate={id:"rate-1",category:"AI_USAGE",code:"ai_credits",revision:1,label:"AI credits",unitPricePaise:250,currency:"INR",taxRateBps:1800,status:"APPROVED",effectiveFrom:new Date("2026-10-01"),effectiveUntil:new Date("2026-12-31"),createdBy:"maker",approvedBy:"checker",approvedAt:new Date("2026-10-03")};
const item={category:"AI_USAGE" as const,code:"ai_credits",label:"AI credits",quantity:100,unitPricePaise:250};
const amount=calculateSchoolOSQuote({basePricePaise:plan.annualPricePaise,items:[item],discountBps:0,taxRateBps:1800});
const quote={id:"q-1",quoteNo:"SO5-20261018-TEST",organizationId:"school-a",status:"CONTRACTED",billingCycle:"ANNUAL",planCode:"GROWTH",validUntil:new Date("2026-11-30"),
createdAt:new Date("2026-10-18"),totalPaise:amount.totalPaise,subtotalPaise:amount.subtotalPaise,taxPaise:amount.taxPaise,
discountBps:0,discountPaise:0,contractDocumentId:"d-1",items:[item],
pricingSnapshot:{pricing:amount,rateCardSnapshot:{planId:plan.id,planCode:plan.code,basePricePaise:plan.annualPricePaise,taxRateBps:plan.taxRateBps,billingCycle:"ANNUAL",currency:"INR"},
addonRateSnapshot:[{rateId:rate.id,revision:rate.revision,category:rate.category,code:rate.code,unitPricePaise:rate.unitPricePaise,currency:rate.currency,taxRateBps:rate.taxRateBps,effectiveFrom:rate.effectiveFrom.toISOString(),effectiveUntil:rate.effectiveUntil!.toISOString()}]}};
const doc={id:"d-1",documentType:"SIGNED_ORDER_FORM",documentReference:quote.quoteNo,organizationId:"school-a",verificationStatus:"VERIFIED",archivedAt:null,
signedAt:new Date("2026-10-19"),verifiedAt:new Date("2026-10-20"),uploadedById:"maker",verifiedById:"checker",lead:{wonOrganizationId:"school-a"}};
test("exact signed add-on quote reconciles each paise and approved rate",()=>{
 const p=validateSchoolOSAddonCheckout(quote,plan,doc,"school-a",[rate],now);
 assert.equal(p.addonsAmountPaise,25000);assert.equal(p.totalPaise,amount.totalPaise);assert.equal(p.lines[0]?.rateId,"rate-1");
});
test("cross-tenant, draft, mutated total or unapproved rate is denied",()=>{
 assert.throws(()=>validateSchoolOSAddonCheckout(quote,plan,doc,"school-b",[rate],now));
 assert.throws(()=>validateSchoolOSAddonCheckout({...quote,status:"DRAFT"},plan,doc,"school-a",[rate],now));
 assert.throws(()=>validateSchoolOSAddonCheckout({...quote,totalPaise:amount.totalPaise+100},plan,doc,"school-a",[rate],now));
 assert.throws(()=>validateSchoolOSAddonCheckout(quote,plan,doc,"school-a",[{...rate,status:"DRAFT"}],now));
});
test("discounts, invented SKU, expired approval and invalid signatory are denied",()=>{
 assert.throws(()=>validateSchoolOSAddonCheckout({...quote,discountBps:100},plan,doc,"school-a",[rate],now));
 assert.throws(()=>validateSchoolOSAddonCheckout({...quote,items:[{...item,category:"CUSTOM_WORK"}]},plan,doc,"school-a",[rate],now));
 assert.throws(()=>validateSchoolOSAddonCheckout(quote,plan,doc,"school-a",[{...rate,effectiveUntil:new Date("2026-11-01")}],now));
 assert.throws(()=>validateSchoolOSAddonCheckout(quote,plan,{...doc,verifiedById:"maker"},"school-a",[rate],now));
});
