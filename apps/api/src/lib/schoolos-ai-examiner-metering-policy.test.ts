import assert from "node:assert/strict";
import test from "node:test";
import { isSchoolOSAIExaminerMeteringEnabled, schoolOSAIExaminerSettlementDecision } from "./schoolos-ai-examiner-metering-policy.js";
test("AI Examiner metering is disabled unless an exact customer tenant is allowlisted",()=>{
 assert.equal(isSchoolOSAIExaminerMeteringEnabled("tenant-one",undefined),false);
 assert.equal(isSchoolOSAIExaminerMeteringEnabled("tenant-one",""),false);
 assert.equal(isSchoolOSAIExaminerMeteringEnabled("tenant-one","*"),false);
 assert.equal(isSchoolOSAIExaminerMeteringEnabled("org_default","org_default"),false);
 assert.equal(isSchoolOSAIExaminerMeteringEnabled("tenant-one","tenant-on"),false);
 assert.equal(isSchoolOSAIExaminerMeteringEnabled("tenant-one"," other ,tenant-one,more"),true);
 assert.equal(isSchoolOSAIExaminerMeteringEnabled("tenant-one","other,tenant-two"),false);
});
test("only persisted, admitted AI evaluation can settle a reserved credit",()=>{
 assert.equal(schoolOSAIExaminerSettlementDecision({metered:false,admitted:false,persistedResult:true}),"DISABLED");
 assert.equal(schoolOSAIExaminerSettlementDecision({metered:true,admitted:false,persistedResult:true}),"NOT_ADMITTED");
 assert.equal(schoolOSAIExaminerSettlementDecision({metered:true,admitted:true,persistedResult:false}),"RECONCILE");
 assert.equal(schoolOSAIExaminerSettlementDecision({metered:true,admitted:true,persistedResult:true}),"COMMIT");
});
