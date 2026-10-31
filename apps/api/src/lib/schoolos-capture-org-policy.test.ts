import assert from "node:assert/strict";
import test from "node:test";
import { assertSchoolOSCaptureOrganizationEligible as guard } from "./schoolos-capture-org-policy.js";
const good: Parameters<typeof guard>[0] = {invoiceOrganizationId:"customer-a",subscriptionOrganizationId:"customer-a",
  organizationStatus:"PAST_DUE",subscriptionStatus:"PAST_DUE",isActive:true,deletedAt:null};
const denied=(input:Parameters<typeof guard>[0],code:string)=>assert.throws(()=>guard(input),
  (e:unknown)=>Boolean(e&&typeof e==="object"&&"code" in e&&e.code===code));

test("signed payment can recover an active, eligible past-due tenant",()=>{
  assert.doesNotThrow(()=>guard(good));
  assert.doesNotThrow(()=>guard({...good,organizationStatus:"TRIAL",subscriptionStatus:"TRIAL"}));
});
test("captured invoice cannot activate a subscription owned by another tenant",()=>{
  denied({...good,subscriptionOrganizationId:"customer-b"},"SCHOOLOS_CAPTURE_SUBSCRIPTION_TENANT_MISMATCH");
});
test("administrative suspension, cancellation, inactive and deleted states fail closed",()=>{
  for(const status of ["SUSPENDED","CANCELLED"]){
    denied({...good,organizationStatus:status},"SCHOOLOS_CAPTURE_ORGANIZATION_SUSPENDED");
    denied({...good,subscriptionStatus:status},"SCHOOLOS_CAPTURE_ORGANIZATION_SUSPENDED");
  }
  denied({...good,isActive:false},"SCHOOLOS_CAPTURE_ORGANIZATION_SUSPENDED");
  denied({...good,deletedAt:new Date("2026-10-31")},"SCHOOLOS_CAPTURE_ORGANIZATION_SUSPENDED");
});
