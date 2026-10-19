import assert from "node:assert/strict";
import test from "node:test";
import { classifyRenewalRecovery } from "./schoolos-renewal-recovery-policy.js";
test("empty invoices require no recovery", () => {
  assert.equal(classifyRenewalRecovery([]).state, "NONE");
});

const date=new Date("2027-01-01T00:00:00Z");
const invoice={id:"new",status:"OPEN",schoolOSQuoteId:"q1",providerOrderId:"p1",dueAt:new Date("2027-01-02T00:00:00Z"),periodStart:date,periodEnd:new Date("2028-01-01T00:00:00Z")};
test("pending provider capture is not mistaken for a paid term",()=>{
 assert.equal(classifyRenewalRecovery([invoice],date).state,"AWAITING_CAPTURE");
});
test("expired provider checkout is reported as an exception",()=>{
 assert.equal(classifyRenewalRecovery([{...invoice,dueAt:date}],date).state,"ORDER_EXPIRED");
});
test("overlapping paid term triggers finance review",()=>{
 const old={...invoice,id:"old",status:"PAID",periodStart:new Date("2026-12-01T00:00:00Z")};
 assert.equal(classifyRenewalRecovery([invoice,old],date).state,"FINANCE_REVIEW");
});
