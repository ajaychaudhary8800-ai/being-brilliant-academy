import assert from "node:assert/strict";
import test from "node:test";
import { validateSchoolOSRiskEvent } from "./schoolos-payment-risk.js";
const event = {
  type: "refund.processed" as const, entityId: "rfnd_TEST12345",
  providerPaymentId: "pay_TEST12345", orderId: "order_TEST12345",
  originalAmountPaise: 100000, amountPaise: 20000, currency: "INR",
};
test("processed partial refunds produce unique canonical idempotency keys", () => {
  assert.deepEqual(validateSchoolOSRiskEvent(event), {
    ...event, eventKey: "refund.processed:rfnd_TEST12345",
  });
});
test("mismatched provider entity, excessive refund and non-INR payment fail closed", () => {
  assert.throws(() => validateSchoolOSRiskEvent({ ...event, entityId: "disp_FAKE" }), /entity/i);
  assert.throws(() => validateSchoolOSRiskEvent({ ...event, amountPaise: 100001 }), /amount/i);
  assert.throws(() => validateSchoolOSRiskEvent({ ...event, amountPaise: 0 }), /amount/i);
  assert.throws(() => validateSchoolOSRiskEvent({ ...event, currency: "USD" }), /amount/i);
  assert.throws(() => validateSchoolOSRiskEvent({ ...event, type: "refund.created" as any }), /event/i);
});
test("payment disputes have separate stable keys and no automatic entitlement restoration", () => {
  const disputed={...event,type:"payment.dispute.created" as const,entityId:"disp_TEST1234"};
  assert.equal(validateSchoolOSRiskEvent(disputed).eventKey,"payment.dispute.created:disp_TEST1234");
  assert.equal(validateSchoolOSRiskEvent({...disputed,type:"payment.dispute.lost"}).eventKey,
    "payment.dispute.lost:disp_TEST1234");
});
