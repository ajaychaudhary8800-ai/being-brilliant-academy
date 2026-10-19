import { Role } from "@prisma/client";
import { Router } from "express";
import { AppError } from "../lib/http.js";
import { ingestSchoolOSLiveKitEvidence,schoolOSVideoEvidencePreview } from "../lib/schoolos-livekit-evidence-service.js";
import { requireAuth,type AuthRequest } from "../middleware/auth.js";
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
export default router;
