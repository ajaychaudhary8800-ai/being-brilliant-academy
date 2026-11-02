import assert from "node:assert/strict";
import test from "node:test";
import { validateSchoolOSFailedRefund as verify } from "./schoolos-refund-failure.js";
const input={refundId:"rfnd_Failure123",paymentId:"pay_Original123",
  orderId:"order_Original123",amountPaise:4000,originalAmountPaise:12000,
  currency:"INR",status:"failed" as const};
test("documented failed refund identifies original captured payment but not cash loss",()=>{
  assert.deepEqual(verify(input),input);
});
test("reject malformed provider identities, missing failed status and inflated amounts",()=>{
  assert.throws(()=>verify({...input,paymentId:"pay-invalid"}),/identifiers/i);
  assert.throws(()=>verify({...input,refundId:"rfnd_"}),/identifiers/i);
  assert.throws(()=>verify({...input,status:"processed" as any}),/state|amount/i);
  assert.throws(()=>verify({...input,amountPaise:12001}),/state|amount/i);
  assert.throws(()=>verify({...input,currency:"USD"}),/state|amount/i);
});
