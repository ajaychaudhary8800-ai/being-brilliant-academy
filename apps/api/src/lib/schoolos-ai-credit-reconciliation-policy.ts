import { AIExaminerEvaluationStatus } from "@prisma/client";

/** A pending credit never becomes refundable solely due to age or a failed job. */
export type SchoolOSAIProof = {
 organizationId:string;
 status:AIExaminerEvaluationStatus;
 completedAt:Date|null;
 provider:string|null;
 model:string|null;
 errorCode:string|null;
 questionCount:number;
};
export type SchoolOSAIReconciliationState =
 "FINANCE_HOLD"|"VERIFIED_SUCCESS"|"PROVIDER_OUTCOME_UNKNOWN"|"IN_PROGRESS"|"EVIDENCE_MISSING";

export function schoolOSAIReconciliationDecision(
 tenantId:string, evaluation:SchoolOSAIProof|null, financeHold:boolean,
):{state:SchoolOSAIReconciliationState; commitEligible:boolean; automaticReleaseAllowed:false} {
 if(financeHold)return {state:"FINANCE_HOLD",commitEligible:false,automaticReleaseAllowed:false};
 if(!evaluation || evaluation.organizationId!==tenantId)
  return {state:"EVIDENCE_MISSING",commitEligible:false,automaticReleaseAllowed:false};
 const verified=(evaluation.status===AIExaminerEvaluationStatus.REVIEW_REQUIRED ||
   evaluation.status===AIExaminerEvaluationStatus.APPROVED) &&
   evaluation.completedAt instanceof Date && Number.isFinite(evaluation.completedAt.getTime()) &&
   Boolean(evaluation.provider?.trim()) && Boolean(evaluation.model?.trim()) &&
   evaluation.questionCount>0 && !evaluation.errorCode;
 if(verified)return {state:"VERIFIED_SUCCESS",commitEligible:true,automaticReleaseAllowed:false};
 if(evaluation.status===AIExaminerEvaluationStatus.QUEUED ||
    evaluation.status===AIExaminerEvaluationStatus.PROCESSING)
   return {state:"IN_PROGRESS",commitEligible:false,automaticReleaseAllowed:false};
 return {state:"PROVIDER_OUTCOME_UNKNOWN",commitEligible:false,automaticReleaseAllowed:false};
}
