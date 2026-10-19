import { Role, SaaSInvoiceStatus } from "@prisma/client";
import { Router } from "express";
import { AppError } from "../lib/http.js";
import { systemPrisma } from "../lib/prisma.js";
import { schoolOSRenewalReadiness } from "../lib/schoolos-renewal-policy.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

const router=Router();
router.use(requireAuth);
async function readiness(organizationId: string) {
  if(!organizationId || organizationId==="org_default")
    throw new AppError(422,"SCHOOLOS_RENEWAL_TENANT_REQUIRED","A customer institution is required");
  const [org,sub,terms,balances,risk]=await Promise.all([
    systemPrisma.organization.findUnique({where:{id:organizationId},
      select:{id:true,isActive:true,deletedAt:true,subscriptionStatus:true,subscriptionEndsAt:true}}),
    systemPrisma.saaSSubscription.findUnique({where:{organizationId},
      select:{status:true,currentPeriodEnd:true,cancelAtPeriodEnd:true}}),
    systemPrisma.saaSInvoice.findMany({where:{organizationId,status:SaaSInvoiceStatus.PAID},
      orderBy:{periodEnd:"desc"},take:50,
      select:{id:true,periodStart:true,periodEnd:true,status:true,schoolOSQuoteId:true}}),
    systemPrisma.schoolOSUsageBalance.findMany({where:{organizationId},
      orderBy:[{periodEnd:"desc"},{metric:"asc"}],take:50,
      select:{metric:true,periodStart:true,periodEnd:true,grantedUnits:true,consumedUnits:true}}),
    systemPrisma.schoolOSPaymentRiskHold.count({where:{organizationId,status:"ACTIVE"}}),
  ]);
  if(!org || org.deletedAt || !org.isActive)
    throw new AppError(404,"SCHOOLOS_RENEWAL_CUSTOMER_NOT_FOUND","Customer institution is unavailable");
  const now=new Date();
  const report=schoolOSRenewalReadiness(terms,{
    subscriptionStatus:sub?.status??org.subscriptionStatus,
    subscriptionEnd:sub?.currentPeriodEnd??org.subscriptionEndsAt,
    cancelAtPeriodEnd:sub?.cancelAtPeriodEnd??false,
  },balances,now);
  return {organizationId,generatedAt:now,...report,
    financeReviewRequired:risk>0,
    credits:report.credits.map(c=>({...c,usableNowUnits:risk>0?0:c.usableNowUnits})),
  };
}
router.get("/organization/subscription/renewal-readiness",async(req:AuthRequest,res)=>{
  if(req.auth?.role!==Role.SUPER_ADMIN || req.auth.organizationId==="org_default" ||
    req.auth.homeOrganizationId!==req.auth.organizationId)
    throw new AppError(403,"TENANT_BILLING_ADMIN_REQUIRED","Customer billing administrator required");
  res.json({data:await readiness(req.auth.organizationId)});
});
router.get("/platform/schoolos/renewals/:organizationId",async(req:AuthRequest,res)=>{
  if(req.auth?.role!==Role.SUPER_ADMIN || req.auth.homeOrganizationId!=="org_default")
    throw new AppError(403,"PLATFORM_ADMIN_REQUIRED","Only platform Super Admin can inspect customer renewals");
  res.json({data:await readiness(String(req.params.organizationId))});
});
export default router;
