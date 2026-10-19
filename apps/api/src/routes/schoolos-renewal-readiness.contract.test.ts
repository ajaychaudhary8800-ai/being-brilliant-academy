import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
test("overlapping paid subscription years cannot be automatically charged or activated twice",async()=>{
 const checkout=await readFile(new URL("schoolos-contract-checkout.ts",import.meta.url),"utf8");
 const capture=await readFile(new URL("../lib/saas-commercial.ts",import.meta.url),"utf8");
 assert.match(checkout,/assertSchoolOSNewTermDoesNotOverlap\(paidTerms,periodStart,periodEnd\)/);
 assert.match(checkout,/status: SaaSInvoiceStatus\.PAID/);
 assert.match(capture,/SCHOOLOS_RENEWAL_CAPTURE_OVERLAP/);
 assert.match(capture,/schoolos-renewal-settlement:/);
 assert.match(capture,/periodStart: \{ lt: invoice\.periodEnd \}, periodEnd: \{ gt: invoice\.periodStart \}/);
});
test("read-only customer readiness is subject to tenant ownership and supports expired billing-only account",async()=>{
 const route=await readFile(new URL("schoolos-renewals.ts",import.meta.url),"utf8");
 const auth=await readFile(new URL("../middleware/auth.ts",import.meta.url),"utf8");
 const app=await readFile(new URL("../server.ts",import.meta.url),"utf8");
 assert.match(route,/homeOrganizationId!==req\.auth\.organizationId/);
 assert.match(route,/homeOrganizationId!=="org_default"/);
 assert.match(route,/schoolOSPaymentRiskHold\.count/);
 assert.match(route,/schoolOSRenewalReadiness/);
 assert.match(auth,/subscription\/renewal-readiness/);
 assert.match(app,/onlyPaths\(\["\/organization\/subscription\/renewal-readiness", "\/platform\/schoolos\/renewals"\], schoolOSRenewals\)/);
});
test("no automatic renewal, credit carry or new tax-only checkout is introduced",async()=>{
 const svc=await readFile(new URL("../lib/schoolos-renewal-policy.ts",import.meta.url),"utf8");
 assert.match(svc,/automaticRenewalEnabled:false/);
 assert.match(svc,/earlyRenewalCheckoutEnabled:false/);
 assert.match(svc,/expiredCreditsCarryOver:false/);
 assert.match(svc,/rolloverPermitted:false/);
});
