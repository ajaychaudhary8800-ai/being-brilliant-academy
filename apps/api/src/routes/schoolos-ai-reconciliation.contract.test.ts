import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
const source=async(name:string)=>readFile(new URL(name,import.meta.url),"utf8");

test("SchoolOS AI reconciliation is platform-only and cannot issue credit releases",async()=>{
 const route=await source("./schoolos-ai-reconciliation.ts");
 assert.match(route,/router\.get\("\/platform\/schoolos\/ai-reconciliation\/\:organizationId"/);
 assert.match(route,/router\.post\("\/platform\/schoolos\/ai-reconciliation\/\:organizationId\/\:evaluationId\/commit"/);
 assert.match(route,/req\.auth\?\.homeOrganizationId!=="org_default"/);
 assert.match(route,/SCHOOLOS_AI_RECONCILIATION_DISABLED/);
 assert.match(route,/reviewerEvidence\.parse\(req\.body\)/);
 assert.doesNotMatch(route,/ai-reconciliation\/\:organizationId\/\:evaluationId\/release/);
});
test("manual AI settlement requires persisted provider outcome and atomic audit",async()=>{
 const service=await source("../lib/schoolos-ai-credit-reservations.ts");
 assert.match(service,/schoolOSAIReconciliationDecision/);
 assert.match(service,/decision\.commitEligible/);
 assert.match(service,/SCHOOLOS_AI_RECONCILIATION_EVIDENCE_MISSING/);
 assert.match(service,/SCHOOLOS_AI_CREDIT_RECONCILED/);
 assert.match(service,/schoolOSPaymentRiskHold/);
});
