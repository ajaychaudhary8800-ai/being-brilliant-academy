import assert from "node:assert/strict";
import test from "node:test";
import { assertSchoolOSRenewalSource, readSchoolOSRenewalContext, type SchoolOSRenewalSource } from "./schoolos-renewal-quote-policy.js";

const end = new Date("2027-01-01T00:00:00.000Z");
const paid: SchoolOSRenewalSource = {
  id:"paid-invoice-one", organizationId:"tenant-one", status:"PAID",
  schoolOSQuoteId:"signed-quote-one", periodEnd:end, schoolOSPaymentRiskHold:null,
};
test("renewal source must be the tenant's latest verified paid SchoolOS contract",()=>{
  const context=assertSchoolOSRenewalSource(paid,"tenant-one",paid.id);
  assert.deepEqual(context,{sourceInvoiceId:paid.id,sourcePeriodEnd:end.toISOString()});
  assert.deepEqual(readSchoolOSRenewalContext({renewal:context}),context);
  assert.throws(()=>assertSchoolOSRenewalSource(paid,"tenant-two",paid.id),/Previous paid/);
  assert.throws(()=>assertSchoolOSRenewalSource(paid,"tenant-one","newer-invoice"),/Latest verified/);
  assert.throws(()=>assertSchoolOSRenewalSource({...paid,status:"OPEN"},"tenant-one",paid.id),/Latest verified/);
  assert.throws(()=>assertSchoolOSRenewalSource({...paid,schoolOSQuoteId:null},"tenant-one",paid.id),/Latest verified/);
});
test("unresolved refund or dispute prevents renewed contract source approval",()=>{
  assert.throws(()=>assertSchoolOSRenewalSource({...paid,schoolOSPaymentRiskHold:{status:"ACTIVE"}},"tenant-one",paid.id),/payment risk/);
  assert.doesNotThrow(()=>assertSchoolOSRenewalSource({...paid,schoolOSPaymentRiskHold:{status:"RESOLVED"}},"tenant-one",paid.id));
});
test("signed renewal source is pinned and activation never overlaps original term",()=>{
  assert.throws(()=>assertSchoolOSRenewalSource(paid,"tenant-one",paid.id,"2028-01-01T00:00:00.000Z"),/no longer matches/);
  assert.throws(()=>assertSchoolOSRenewalSource(paid,"tenant-one",paid.id,end.toISOString(),new Date("2026-12-31T23:59:59Z")),/cannot activate before/);
  assert.doesNotThrow(()=>assertSchoolOSRenewalSource(paid,"tenant-one",paid.id,end.toISOString(),end));
  assert.equal(readSchoolOSRenewalContext({}),null);
  for(const renewal of [null,{}, {sourceInvoiceId:"id",sourcePeriodEnd:"invalid"},
    {sourceInvoiceId:"id",sourcePeriodEnd:"2027-01-01"}])
    assert.throws(()=>readSchoolOSRenewalContext({renewal}),/evidence is incomplete/);
});
