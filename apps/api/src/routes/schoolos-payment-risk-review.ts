import { Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/http.js";
import {
  listSchoolOSRiskReviews,proposeSchoolOSRiskRelease,decideSchoolOSRiskRelease,
} from "../lib/schoolos-risk-resolution.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

const router=Router();
router.use(requireAuth);
function platformOnly(req:AuthRequest) {
  if(req.auth?.role!==Role.SUPER_ADMIN || req.auth.homeOrganizationId!=="org_default")
    throw new AppError(403,"PLATFORM_ADMIN_REQUIRED","Only the SchoolOS platform administrator can review provider financial risk");
}
const propose=z.object({
  invoiceId:z.string().min(8).max(100),
  evidenceReference:z.string().trim().min(12).max(250),
  rationale:z.string().trim().min(20).max(2000),
}).strict();
const decision=z.object({
  decision:z.enum(["APPROVE","REJECT"]),
  reviewComment:z.string().trim().min(20).max(2000),
}).strict();

router.get("/platform/schoolos/payment-risk",async(req:AuthRequest,res)=>{
  platformOnly(req);
  res.json({data:await listSchoolOSRiskReviews()});
});
router.post("/platform/schoolos/payment-risk/reviews",async(req:AuthRequest,res)=>{
  platformOnly(req);
  const fields=propose.parse(req.body);
  const review=await proposeSchoolOSRiskRelease(fields.invoiceId,req.auth!.userId,
    fields.evidenceReference,fields.rationale);
  res.status(201).json({data:review,meta:{automaticRelease:false,requiresIndependentApprover:true}});
});
router.post("/platform/schoolos/payment-risk/reviews/:reviewId/decision",async(req:AuthRequest,res)=>{
  platformOnly(req);
  const fields=decision.parse(req.body);
  const review=await decideSchoolOSRiskRelease(String(req.params.reviewId),req.auth!.userId,
    fields.decision,fields.reviewComment);
  res.json({data:review});
});
export default router;
