import assert from "node:assert/strict";
import test from "node:test";
import { schoolOSDisputeReleasePolicy } from "./schoolos-dispute-release-policy.js";
const created={eventType:"payment.dispute.created",providerEntityId:"disp_1",providerPaymentId:"pay_1",amountPaise:6000};
const won={...created,eventType:"payment.dispute.won"};
test("every signed created dispute must be matched to a won dispute",()=>{
 assert.equal(schoolOSDisputeReleasePolicy([created,won]).allowed,true);
 assert.equal(schoolOSDisputeReleasePolicy([created]).allowed,false);
 assert.equal(schoolOSDisputeReleasePolicy([]).allowed,false);
 assert.equal(schoolOSDisputeReleasePolicy([won]).allowed,false);
});
test("refund, lost dispute and mismatching amount keep all paid features frozen",()=>{
 assert.equal(schoolOSDisputeReleasePolicy([created,won,{...created,eventType:"refund.processed",providerEntityId:"rfnd_1"}]).allowed,false);
 assert.equal(schoolOSDisputeReleasePolicy([created,won,{...created,eventType:"payment.dispute.lost"}]).allowed,false);
 assert.equal(schoolOSDisputeReleasePolicy([created,{...won,amountPaise:5000}]).allowed,false);
 assert.equal(schoolOSDisputeReleasePolicy([created,{...won,providerPaymentId:"pay_other"}]).allowed,false);
});
test("a second unresolved dispute blocks an otherwise won first dispute",()=>{
 const another={...created,providerEntityId:"disp_2"};
 assert.equal(schoolOSDisputeReleasePolicy([created,won,another]).allowed,false);
 assert.equal(schoolOSDisputeReleasePolicy([created,won,another,{...another,eventType:"payment.dispute.won"}]).allowed,true);
});
