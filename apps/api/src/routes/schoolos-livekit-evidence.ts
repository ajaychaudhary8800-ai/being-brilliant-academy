import { Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/http.js";
import { ingestSchoolOSLiveKitEvidence,schoolOSVideoEvidencePreview } from "../lib/schoolos-livekit-evidence-service.js";
import { requireAuth,type AuthRequest } from "../middleware/auth.js";
import { proposeSchoolOSVideoReview,decideSchoolOSVideoReview,listSchoolOSVideoReviews } from "../lib/schoolos-video-review-service.js";
import { proposeSchoolOSZeroVideoRelease,decideSchoolOSZeroVideoRelease } from "../lib/schoolos-video-zero-release-service.js";
const router=Router();
/** No tenant or browser may submit unsigned attendance as provider evidence. */
router.post("/platform/schoolos/livekit/webhook",async(req,res)=>{
 if(!Buffer.isBuffer(req.body))
  throw new AppError(415,"SCHOOLOS_LIVEKIT_RAW_BODY_REQUIRED","Signed raw LiveKit webhook body required");
 const data=await ingestSchoolOSLiveKitEvidence(req.body,req.header("authorization"));
 res.status(200).json({data});
});
router.get("/platform/schoolos/video-evidence/:organizationId/:meetingId",requireAuth,async(req:AuthRequest,res)=>{
 if(req.auth?.role!==Role.SUPER_ADMIN || req.auth.homeOrganizationId!=="org_default")
  throw new AppError(403,"PLATFORM_ADMIN_REQUIRED","Platform super administrator required");
 res.json({data:await schoolOSVideoEvidencePreview(
  String(req.params.organizationId),String(req.params.meetingId))});
});

function platformFinance(req:AuthRequest) {
 if(req.auth?.role!==Role.SUPER_ADMIN || req.auth.homeOrganizationId!=="org_default")
  throw new AppError(403,"PLATFORM_ADMIN_REQUIRED","Platform administrator required");
}
const proposalFields=z.object({
 evidenceReference:z.string().trim().min(12).max(250),
 rationale:z.string().trim().min(20).max(2000),
}).strict();
const decisionFields=z.object({
 decision:z.enum(["APPROVE","REJECT"]),
 reviewComment:z.string().trim().min(20).max(2000),
}).strict();
router.get("/platform/schoolos/video-reviews/:organizationId",requireAuth,async(req:AuthRequest,res)=>{
 platformFinance(req);
 res.json({data:await listSchoolOSVideoReviews(String(req.params.organizationId))});
});
router.post("/platform/schoolos/video-reviews/:organizationId/:meetingId",requireAuth,async(req:AuthRequest,res)=>{
 platformFinance(req);
 const fields=proposalFields.parse(req.body);
 const result=await proposeSchoolOSVideoReview(String(req.params.organizationId),
  String(req.params.meetingId),req.auth!.userId,fields.evidenceReference,fields.rationale);
 res.status(201).json({data:result,meta:{requiresIndependentApprover:true,automaticCharge:false}});
});
router.post("/platform/schoolos/video-reviews/:organizationId/:reviewId/decision",requireAuth,async(req:AuthRequest,res)=>{
 platformFinance(req);
 const fields=decisionFields.parse(req.body);
 const result=await decideSchoolOSVideoReview(String(req.params.organizationId),
  String(req.params.reviewId),req.auth!.userId,fields.decision,fields.reviewComment);
 res.json({data:result,meta:{manualApproval:true,automaticPaymentCapture:false}});
});

/** Zero-usage holds have a separate signed-evidence and 72-hour proof route.
 * Both calls require an independent platform finance administrator. */
router.post("/platform/schoolos/video-zero-release/:organizationId/:meetingId",requireAuth,
 async(req:AuthRequest,res)=>{
  platformFinance(req);
  const fields=proposalFields.parse(req.body);
  const result=await proposeSchoolOSZeroVideoRelease(
    String(req.params.organizationId),String(req.params.meetingId),req.auth!.userId,
    fields.evidenceReference,fields.rationale,
  );
  res.status(201).json({data:result,meta:{providerOutcomeRequired:true,automaticRelease:false}});
 });
router.post("/platform/schoolos/video-zero-release/:organizationId/:reviewId/decision",requireAuth,
 async(req:AuthRequest,res)=>{
  platformFinance(req);
  const fields=decisionFields.parse(req.body);
  const result=await decideSchoolOSZeroVideoRelease(
    String(req.params.organizationId),String(req.params.reviewId),req.auth!.userId,
    fields.decision,fields.reviewComment,
  );
  res.json({data:result,meta:{independentProviderCheck:true,automaticRelease:false}});
 });
export default router;
