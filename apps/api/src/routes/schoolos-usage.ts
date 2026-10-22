import { Role } from "@prisma/client";
import { Router } from "express";
import { AppError } from "../lib/http.js";
import { schoolOSUsageReport } from "../lib/schoolos-usage-service.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);
router.get("/organization/subscription/usage-credits", async (req: AuthRequest, res) => {
  if (req.auth?.role !== Role.SUPER_ADMIN || req.auth.organizationId === "org_default"
    || req.auth.homeOrganizationId !== req.auth.organizationId)
    throw new AppError(403, "TENANT_BILLING_ADMIN_REQUIRED", "Organization billing administrator required");
  res.json({ data: await schoolOSUsageReport(req.auth.organizationId) });
});
router.get("/platform/schoolos/usage/:organizationId", async (req: AuthRequest, res) => {
  if (req.auth?.role !== Role.SUPER_ADMIN || req.auth.homeOrganizationId !== "org_default")
    throw new AppError(403, "PLATFORM_ADMIN_REQUIRED", "Platform super administrator required");
  res.json({ data: await schoolOSUsageReport(String(req.params.organizationId)) });
});
export default router;
