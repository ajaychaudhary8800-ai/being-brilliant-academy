import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
test("renewal signed-origin enforcement survives quote creation, checkout and captured settlement",async()=>{
 const quote=await readFile(new URL("./schoolos-quotations.ts",import.meta.url),"utf8");
 const checkout=await readFile(new URL("./schoolos-contract-checkout.ts",import.meta.url),"utf8");
 const settlement=await readFile(new URL("../lib/saas-commercial.ts",import.meta.url),"utf8");
 assert.match(quote,/renewalSourceInvoiceId: z\.string/);
 assert.match(quote,/assertSchoolOSRenewalSource\(source, input\.organizationId/);
 assert.match(quote,/renewal: renewal \?\? undefined/);
 assert.match(checkout,/readSchoolOSRenewalContext\(quote\.pricingSnapshot\)/);
 assert.match(checkout,/assertSchoolOSRenewalSource\(renewalSource, organizationId/);
 assert.match(settlement,/readSchoolOSRenewalContext\(quote\.pricingSnapshot\)/);
 assert.match(settlement,/assertSchoolOSRenewalSource\(renewalSource, invoice\.organizationId/);
 assert.match(settlement,/invoice\.periodStart/);
});
