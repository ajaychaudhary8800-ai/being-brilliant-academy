import assert from "node:assert/strict";
import test from "node:test";
import { AIExaminerEvaluationStatus as Status } from "@prisma/client";
import { schoolOSAIReconciliationDecision } from "./schoolos-ai-credit-reconciliation-policy.js";

const proof={organizationId:"school-A",status:Status.REVIEW_REQUIRED,
  completedAt:new Date("2026-10-19T07:00:00Z"),provider:"api.example",model:"examiner-v1",
  errorCode:null,questionCount:3};
test("verified tenant-owned persisted result is eligible for manual settlement",()=>{
 assert.deepEqual(schoolOSAIReconciliationDecision("school-A",proof,false),
  {state:"VERIFIED_SUCCESS",commitEligible:true,automaticReleaseAllowed:false});
 assert.equal(schoolOSAIReconciliationDecision("school-A",{...proof,status:Status.APPROVED},false).commitEligible,true);
});
test("finance hold, foreign evidence and incomplete results cannot commit or auto-release",()=>{
 const variants=[
  schoolOSAIReconciliationDecision("school-A",proof,true),
  schoolOSAIReconciliationDecision("school-B",proof,false),
  schoolOSAIReconciliationDecision("school-A",null,false),
  schoolOSAIReconciliationDecision("school-A",{...proof,completedAt:null},false),
  schoolOSAIReconciliationDecision("school-A",{...proof,questionCount:0},false),
  schoolOSAIReconciliationDecision("school-A",{...proof,errorCode:"PROVIDER_FAILED"},false),
  schoolOSAIReconciliationDecision("school-A",{...proof,status:Status.FAILED},false),
 ];
 for (const result of variants) {
  assert.equal(result.commitEligible,false);
  assert.equal(result.automaticReleaseAllowed,false);
 }
 assert.equal(variants[0]?.state,"FINANCE_HOLD");
 assert.equal(variants[1]?.state,"EVIDENCE_MISSING");
});
test("unknown/processing provider state cannot be inferred as a refundable failure",()=>{
 assert.equal(schoolOSAIReconciliationDecision("school-A",{...proof,status:Status.PROCESSING},false).state,"IN_PROGRESS");
 assert.equal(schoolOSAIReconciliationDecision("school-A",{...proof,status:Status.FAILED},false).state,"PROVIDER_OUTCOME_UNKNOWN");
});
