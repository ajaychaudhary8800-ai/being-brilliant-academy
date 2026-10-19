import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
const content=async(path:string)=>readFile(new URL(path,import.meta.url),"utf8");
test("only platform administrators can propose/approve video credit reviews",async()=>{
 const route=await content("./schoolos-livekit-evidence.ts");
 const server=await content("../server.ts");
 assert.match(route,/homeOrganizationId!=="org_default"/);
 assert.match(route,/router\.post\("\/platform\/schoolos\/video-reviews\/\:organizationId\/\:meetingId"/);
 assert.match(route,/router\.post\("\/platform\/schoolos\/video-reviews\/\:organizationId\/\:reviewId\/decision"/);
 assert.match(route,/requiresIndependentApprover:true,automaticCharge:false/);
 assert.match(route,/manualApproval:true,automaticPaymentCapture:false/);
 assert.match(server,/\/platform\/schoolos\/video-reviews/);
});
test("review and paid ledger settlement are independently disabled by default",async()=>{
 const schema=await content("../config.ts");
 const service=await content("../lib/schoolos-video-review-service.ts");
 assert.match(schema,/SCHOOLOS_VIDEO_SETTLEMENT_ENABLED: z\.string\(\)\.default\("false"\)/);
 assert.match(service,/requireApproval\(organizationId\)/);
 assert.match(service,/schoolOSPaymentRiskHold\.findFirst/);
 assert.match(service,/proposedBy===reviewedBy/);
 assert.match(service,/SCHOOLOS_VIDEO_EVIDENCE_CHANGED/);
 assert.match(service,/sourceInvoice:/);
 assert.match(service,/providerOrderId:\{not:null\}/);
 assert.match(service,/payments:\{some:\{status:"CAPTURED"/);
 assert.match(service,/SCHOOLOS_VIDEO_USAGE_REVIEW_SETTLED/);
 assert.doesNotMatch(service,/razorpay\.capture|createPayment|transferFunds/);
});
