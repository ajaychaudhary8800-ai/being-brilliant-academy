import { Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config.js";
import { AppError } from "../lib/http.js";
import { isSchoolOSAIExaminerMeteringEnabled } from "../lib/schoolos-ai-examiner-metering-policy.js";
import { schoolOSAIReconciliationQueue } from "../lib/schoolos-ai-credit-reconciliation.js";
import { commitSchoolOSAIExaminerCredit } from "../lib/schoolos-ai-credit-reservations.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

const router=Router();
router.use(requireAuth);
function requirePlatformFinance(req:AuthRequest) {
 if(req.auth?.role!==Role.SUPER_ADMIN || req.auth.homeOrganizationId!=="org_default")
  throw new AppError(403,"PLATFORM_ADMIN_REQUIRED","Platform finance administrator required");
}
const reviewerEvidence=z.object({
 evidenceReference:z.string().trim().min(12).max(250),
 reviewComment:z.string().trim().min(20).max(2000),
}).strict();

router.get("/platform/schoolos/ai-reconciliation/:organizationId",async(req:AuthRequest,res)=>{
 requirePlatformFinance(req);
 const orgId=String(req.params.organizationId);
 const limit=z.coerce.number().int().min(1).max(100).default(50).parse(req.query.limit);
 res.json({data:await schoolOSAIReconciliationQueue(orgId,limit)});
});
router.post("/platform/schoolos/ai-reconciliation/:organizationId/:evaluationId/commit",async(req:AuthRequest,res)=>{
 requirePlatformFinance(req);
 const orgId=String(req.params.organizationId);
 const evaluationId=String(req.params.evaluationId);
 if(!isSchoolOSAIExaminerMeteringEnabled(orgId,env.SCHOOLOS_AI_METERING_TENANT_IDS))
  throw new AppError(409,"SCHOOLOS_AI_RECONCILIATION_DISABLED",
   "Manual AI credit settlement is disabled until tenant metering is explicitly approved");
 const fields=reviewerEvidence.parse(req.body);
 const result=await commitSchoolOSAIExaminerCredit(orgId,evaluationId,{
  actorId:req.auth!.userId,evidenceReference:fields.evidenceReference,
  reviewComment:fields.reviewComment,
 });
 res.json({data:{...result,organizationId:orgId,evaluationId},
  meta:{manualSettlement:true,automaticCreditRelease:false,financialEvidenceRequired:true}});
});
export default router;
