import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("failed payments and dispute children come from HMAC-verified original provider payload",async()=>{
 const route=await readFile(new URL("payments.ts",import.meta.url),"utf8");
 assert.match(route,/INVALID_SIGNATURE/);
 assert.match(route,/const originalEvent = JSON.parse\(raw.toString/);
 assert.match(route,/\.parse\(originalEvent\)/);
 assert.match(route,/event.event === "payment.failed"/);
 assert.match(route,/status:z.literal\("failed"\)/);
 assert.match(route,/recordSchoolOSFailedPayment/);
 assert.match(route,/recordSchoolOSPaymentRisk/);
 const svc=await readFile(new URL("../lib/schoolos-payment-failure.ts",import.meta.url),"utf8");
 assert.match(svc,/schoolos-renewal-settlement:/);
 assert.match(svc,/invoice.status==="PAID"/);
 assert.match(svc,/SaaSPaymentStatus.FAILED/);
 assert.doesNotMatch(svc,/orders\.create|status:"PAID",paidAt/);
});
test("renewal failure recovery only exposes tenant billing view without unpaid grace",async()=>{
 const route=await readFile(new URL("schoolos-renewals.ts",import.meta.url),"utf8");
 const auth=await readFile(new URL("../middleware/auth.ts",import.meta.url),"utf8");
 assert.match(route,/schoolOSPaymentRecoverySnapshot/);
 assert.match(route,/status:SaaSInvoiceStatus.OPEN/);
 assert.match(route,/payments:\{where:\{status:"FAILED"\}\}/);
 assert.match(route,/homeOrganizationId!==req\.auth\.organizationId/);
 assert.match(auth,/subscription\/renewal-readiness/);
 const policy=await readFile(new URL("../lib/schoolos-payment-failure-policy.ts",import.meta.url),"utf8");
 assert.match(policy,/unpaidAccessExtensionEnabled: false/);
 assert.match(policy,/gracePeriodDays: 0/);
});
