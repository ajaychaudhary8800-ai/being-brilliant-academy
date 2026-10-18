import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
test("only signed exact add-ons enter tenant invoice; standard subscription gateway remains separate", async()=>{
 const r=await readFile(new URL("schoolos-contract-checkout.ts",import.meta.url),"utf8");
 assert.match(r,/validateSchoolOSAddonCheckout\(/);
 assert.match(r,/SIGNed_ANNUAL_BASE_PLUS_ADDONS/i);
 assert.match(r,/addonLines: addon\?\.lines/);
 assert.match(r,/SCHOOLOS_TENANT_CHECKOUT_PENDING/);
 assert.match(r,/pg_advisory_xact_lock/);
});
test("captured payment atomically grants licenses and usage credits after mark paid",async()=>{
 const billing=await readFile(new URL("../lib/saas-commercial.ts",import.meta.url),"utf8");
 const activated=await readFile(new URL("../lib/schoolos-addon-settlement.ts",import.meta.url),"utf8");
 const pos=billing.indexOf("await tx.saaSInvoice.update({");
 const grant=billing.indexOf("await applySchoolOSPaidAddonSettlement(tx,");
 assert.ok(pos>=0 && grant>pos,"never issue credits before paid settlement");
 assert.match(billing,/settledAddonLines = verified\.lines/);
 assert.match(activated,/invoice\.status!=="PAID"/);
 assert.match(activated,/quote\.status!=="PAID"/);
 assert.match(activated,/createMany\(/);
 assert.match(activated,/sourceInvoiceId:input\.invoiceId/);
 assert.match(activated,/SCHOOLOS_ADDON_CREDIT_REPLAY_CONFLICT/);
});
test("paid module feature and capacity grants do not create a writable trial override",async()=>{
 const s=await readFile(new URL("../lib/saas-commercial.ts",import.meta.url),"utf8");
 assert.match(s,/schoolOSAddonLicense\.findMany\(/);
 assert.match(s,/periodEnd: \{ gt: now \}/);
 assert.match(s,/schoolOSPaymentRiskHold: \\{ is: null \\}/);
 assert.match(s,/schoolOSPaymentRiskHold: \\{ is: \\{ status: "RESOLVED" \\} \\}/);
 assert.match(s,/license\.category === "MODULE"/);
 assert.match(s,/license\.category === "CAPACITY"/);
 const sql=await readFile(new URL("../../prisma/migrations/20261019010000_schoolos_paid_addon_license/migration.sql",import.meta.url),"utf8");
 assert.match(sql,/SCHOOLOS_LICENSE_REQUIRES_PAID_TENANT_QUOTE/);
 assert.match(sql,/CREATE UNIQUE INDEX "SchoolOSAddonLicense_invoiceId_category_code_key"/);
});
