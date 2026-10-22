import { Role } from "@prisma/client";
import { Router } from "express";
import { AppError } from "../lib/http.js";
import { systemPrisma } from "../lib/prisma.js";
import {
  SCHOOL_OS_COMMERCIAL_REFERENCE, reconcileSchoolOSPricing, schoolOSExternalQuoteReady,
} from "../lib/schoolos-pricing-reconciliation.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);
function requirePlatformAdmin(req: AuthRequest) {
  if (req.auth?.role !== Role.SUPER_ADMIN || req.auth.homeOrganizationId !== "org_default")
    throw new AppError(403, "PLATFORM_ADMIN_REQUIRED", "Platform super administrator access required");
}
router.get("/platform/schoolos/pricing/reconciliation", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const plans = await systemPrisma.saaSPlan.findMany();
  const evaluations = Object.keys(SCHOOL_OS_COMMERCIAL_REFERENCE.tiers).map(code => {
    const plan = plans.find(item => item.code === code) ?? null;
    return reconcileSchoolOSPricing(code, plan);
  });
  res.json({
    data: {
      reference: SCHOOL_OS_COMMERCIAL_REFERENCE,
      evaluations,
      aligned: evaluations.every(item => item.status === "ALIGNED"),
      productionPricesModified: false,
      externalIssuanceEnabled: false,
    },
  });
});
router.get("/platform/schoolos/pricing/quotes/:quoteId/readiness", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const quote = await systemPrisma.schoolOSQuotation.findUnique({
    where: { id: String(req.params.quoteId) },
  });
  if (!quote) throw new AppError(404, "SCHOOLOS_QUOTE_NOT_FOUND", "Quotation not found");
  const plan = await systemPrisma.saaSPlan.findUnique({ where: { code: quote.planCode } });
  const reconciliation = reconcileSchoolOSPricing(quote.planCode, plan);
  const readiness = schoolOSExternalQuoteReady({
    quoteStatus: quote.status, validUntil: quote.validUntil, clientOrganizationId: quote.organizationId,
    planResult: reconciliation,
  });
  res.json({ data: { quoteNo: quote.quoteNo, quoteId: quote.id, reconciliation, readiness } });
});
export default router;
