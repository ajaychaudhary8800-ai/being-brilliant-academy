import assert from "node:assert/strict";
import test from "node:test";
import { assertSchoolOSRiskReleasePaymentEvidence as verify } from "./schoolos-risk-resolution.js";

const captured = {
  organizationId:"tenant-test",provider:"RAZORPAY",status:"CAPTURED",
  amountPaise:11800,currency:"INR",providerPaymentId:"pay_exact",
};
const raised = {
  organizationId:"tenant-test",providerPaymentId:"pay_exact",
  amountPaise:11800,currency:"INR",
};
const denied = (fn: () => void, code: string) =>
  assert.throws(fn,(err:unknown)=>Boolean(err && typeof err==="object" &&
    "code" in err && err.code===code));

test("independently verified single captured payment permits release eligibility evaluation",()=>{
  assert.doesNotThrow(()=>verify("tenant-test",11800,
    [captured,{...captured,status:"FAILED",providerPaymentId:"pay_failed"}],[raised]));
});
test("multiple captured or refunded payments fail closed before release",()=>{
  denied(()=>verify("tenant-test",11800,[captured,{...captured,providerPaymentId:"pay_second"}],[raised]),
    "SCHOOLOS_RISK_PAYMENT_LEDGER_MISMATCH");
  denied(()=>verify("tenant-test",11800,[captured,{...captured,status:"REFUNDED"}],[raised]),
    "SCHOOLOS_RISK_PAYMENT_LEDGER_MISMATCH");
});
test("foreign or malformed captured evidence cannot clear a finance hold",()=>{
  denied(()=>verify("tenant-test",11800,[{...captured,organizationId:"other-tenant"}],[raised]),
    "SCHOOLOS_RISK_PAYMENT_LEDGER_MISMATCH");
  denied(()=>verify("tenant-test",11800,[{...captured,amountPaise:11799}],[raised]),
    "SCHOOLOS_RISK_PAYMENT_LEDGER_MISMATCH");
});
test("unrelated or tenant-crossing dispute adjustments cannot clear a hold",()=>{
  denied(()=>verify("tenant-test",11800,[captured],[{...raised,providerPaymentId:"pay_other"}]),
    "SCHOOLOS_RISK_ADJUSTMENT_LEDGER_MISMATCH");
  denied(()=>verify("tenant-test",11800,[captured],[{...raised,organizationId:"other-tenant"}]),
    "SCHOOLOS_RISK_ADJUSTMENT_LEDGER_MISMATCH");
});
