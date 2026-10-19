import assert from "node:assert/strict";
import test from "node:test";
import { validateSchoolOSFailedPayment, schoolOSPaymentRecoverySnapshot } from "./schoolos-payment-failure-policy.js";

const input={providerPaymentId:"pay_A1",orderId:"order_ABC123",amountPaise:590000,currency:"INR"};
const now=new Date("2026-10-20T00:00:00Z");
const invoice={id:"invoice-one",invoiceNo:"SOI-2026-1",schoolOSQuoteId:"quote-one",
  providerOrderId:"order_ABC123",dueAt:new Date("2026-10-21T00:00:00Z"),failedAttempts:2};

test("accept valid failed provider evidence and reject wrong amount, currency or identity",()=>{
 assert.equal(validateSchoolOSFailedPayment({...input,currency:"inr"}).currency,"INR");
 for (const bad of [{...input,amountPaise:0},{...input,amountPaise:1.5},
   {...input,currency:"USD"},{...input,providerPaymentId:"invalid"},
   {...input,orderId:"bad-id"},{...input,errorCode:"unsafe private description"}])
   assert.throws(()=>validateSchoolOSFailedPayment(bad),/Invalid|amount|reason/);
});

test("retry only the same live order, never create an order or grant unpaid grace",()=>{
 const recovery=schoolOSPaymentRecoverySnapshot(invoice,false,now);
 assert.equal(recovery.status,"RETRY_EXISTING_ORDER");
 assert.equal(recovery.retryExistingOrderAllowed,true);
 assert.equal(recovery.createNewOrderAllowed,false);
 assert.equal(recovery.checkoutPath,"/organization/subscription/contracted-checkout");
 assert.equal(recovery.gracePeriodDays,0);
 assert.equal(recovery.unpaidAccessExtensionEnabled,false);
 const expired=schoolOSPaymentRecoverySnapshot({...invoice,dueAt:now},false,now);
 assert.equal(expired.status,"MANUAL_RECONCILIATION_REQUIRED");
 assert.equal(expired.retryExistingOrderAllowed,false);
 assert.equal(schoolOSPaymentRecoverySnapshot(invoice,true,now).status,"FINANCE_HOLD");
 assert.equal(schoolOSPaymentRecoverySnapshot(null,false,now).status,"NO_PENDING_ORDER");
 assert.equal(schoolOSPaymentRecoverySnapshot({...invoice,failedAttempts:0},false,now).status,"AWAITING_PAYMENT");
});
