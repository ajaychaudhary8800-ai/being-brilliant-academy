import { AppError } from "./http.js";
import { systemPrisma } from "./prisma.js";
import { schoolOSAIReconciliationDecision } from "./schoolos-ai-credit-reconciliation-policy.js";

/** Read-only operator queue. No job polling may change credits or release holds. */
export async function schoolOSAIReconciliationQueue(organizationId:string,limit=50) {
 if(!organizationId || organizationId==="org_default")
  throw new AppError(422,"SCHOOLOS_AI_RECONCILIATION_TENANT_REQUIRED","Customer institution required");
 if(!Number.isSafeInteger(limit) || limit<1 || limit>100)
  throw new AppError(422,"SCHOOLOS_AI_RECONCILIATION_PAGE_INVALID","Page size must be between 1 and 100");
 const [reservations,total,holds]=await Promise.all([
  systemPrisma.schoolOSUsageReservation.findMany({
   where:{organizationId,metric:"ai_credits",status:"RESERVED"},
   orderBy:[{createdAt:"asc"},{id:"asc"}],take:limit,
   select:{id:true,balanceId:true,requestKey:true,units:true,createdAt:true},
  }),
  systemPrisma.schoolOSUsageReservation.count({
   where:{organizationId,metric:"ai_credits",status:"RESERVED"},
  }),
  systemPrisma.schoolOSPaymentRiskHold.count({where:{organizationId,status:"ACTIVE"}}),
 ]);
 const entries=reservations.map(row=>({...row,
  evaluationId:row.requestKey.startsWith("ai-examiner:")?row.requestKey.slice("ai-examiner:".length):null,
 }));
 const ids=entries.map(row=>row.evaluationId).filter((id):id is string=>Boolean(id));
 const evaluations=ids.length?await systemPrisma.aIExaminerEvaluation.findMany({
  where:{organizationId,id:{in:ids}},
  select:{id:true,organizationId:true,status:true,completedAt:true,provider:true,model:true,errorCode:true,
   _count:{select:{questions:true}}},
 }):[];
 const byId=new Map(evaluations.map(e=>[e.id,e]));
 return {
  organizationId,total,returned:entries.length,truncated:total>entries.length,
  financeHoldActive:holds>0,
  items:entries.map(row=>{
   const evaluation=row.evaluationId?byId.get(row.evaluationId):null;
   const decision=schoolOSAIReconciliationDecision(organizationId,evaluation?{
    organizationId:evaluation.organizationId,status:evaluation.status,completedAt:evaluation.completedAt,
    provider:evaluation.provider,model:evaluation.model,errorCode:evaluation.errorCode,
    questionCount:evaluation._count.questions,
   }:null,holds>0);
   return {
    reservationId:row.id,creditBalanceId:row.balanceId,evaluationId:row.evaluationId,
    reservedAt:row.createdAt,units:row.units,
    evaluationStatus:evaluation?.status??null,completedAt:evaluation?.completedAt??null,
    ...decision,
   };
  }),
  automaticReleaseEnabled:false,automaticSettlementEnabled:false,
 };
}
