import { Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/http.js";
import { systemPrisma } from "../lib/prisma.js";
import { isSupportedSchoolOSAddon, schoolOSAddonWindowOverlaps } from "../lib/schoolos-addon-pricing-policy.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);
function platformOnly(req: AuthRequest) {
  if (req.auth?.role !== Role.SUPER_ADMIN || req.auth.homeOrganizationId !== "org_default")
    throw new AppError(403, "PLATFORM_ADMIN_REQUIRED", "Only a platform super administrator may manage add-on prices");
}
const proposal = z.object({
  category: z.enum(["MODULE", "CAPACITY", "AI_USAGE", "VIDEO_USAGE", "IMPLEMENTATION"]),
  code: z.string().trim().regex(/^[a-z0-9_]{2,50}$/),
  label: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  unitPricePaise: z.number().int().positive().max(2_147_483_647),
  taxRateBps: z.number().int().min(0).max(10_000),
  effectiveFrom: z.string().datetime({ offset: true }),
  effectiveUntil: z.string().datetime({ offset: true }).nullable().optional(),
}).strict();
const decision = z.object({
  approvalReference: z.string().trim().min(12).max(250),
  reason: z.string().trim().min(12).max(1000),
}).strict();

router.get("/platform/schoolos/addon-rates", async (req: AuthRequest, res) => {
  platformOnly(req);
  const rows = await systemPrisma.schoolOSAddonRate.findMany({
    orderBy: [{ category: "asc" }, { code: "asc" }, { revision: "desc" }],
    take: 200,
  });
  res.json({ data: rows, meta: { externalCheckoutEnabled: false, activeCustomerBilling: false } });
});

router.post("/platform/schoolos/addon-rates", async (req: AuthRequest, res) => {
  platformOnly(req);
  const data = proposal.parse(req.body);
  if (!isSupportedSchoolOSAddon(data.category, data.code))
    throw new AppError(422, "SCHOOLOS_ADDON_NOT_SUPPORTED", "Only a catalogued module or usage item can be priced");
  const start = new Date(data.effectiveFrom);
  const end = data.effectiveUntil ? new Date(data.effectiveUntil) : null;
  if (end && end.getTime() <= start.getTime())
    throw new AppError(422, "SCHOOLOS_ADDON_RATE_WINDOW_INVALID", "End must be later than start");
  const saved = await systemPrisma.$transaction(async tx => {
    const key = `schoolos-addon-rate:${data.category}:${data.code}`;
    await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext(${key}))`;
    const latest = await tx.schoolOSAddonRate.findFirst({
      where: { category: data.category, code: data.code },
      orderBy: { revision: "desc" },
    });
    const created = await tx.schoolOSAddonRate.create({
      data: {
        category: data.category, code: data.code, revision: (latest?.revision ?? 0) + 1,
        label: data.label, description: data.description ?? null,
        currency: "INR", unitPricePaise: data.unitPricePaise, taxRateBps: data.taxRateBps,
        effectiveFrom: start, effectiveUntil: end, createdBy: req.auth!.userId, status: "DRAFT",
      },
    });
    await tx.auditLog.create({
      data: { organizationId: "org_default", actorId: req.auth!.userId,
        action: "SCHOOLOS_ADDON_RATE_PROPOSED", entity: "SchoolOSAddonRate", entityId: created.id,
        metadata: { category: data.category, code: data.code, revision: created.revision, unitPricePaise: data.unitPricePaise } },
    });
    return created;
  });
  res.status(201).json({ data: saved });
});

router.post("/platform/schoolos/addon-rates/:id/approve", async (req: AuthRequest, res) => {
  platformOnly(req);
  const id = String(req.params.id);
  const { approvalReference, reason } = decision.parse(req.body);
  const saved = await systemPrisma.$transaction(async tx => {
    const initial = await tx.schoolOSAddonRate.findUnique({ where: { id } });
    if (!initial) throw new AppError(404, "SCHOOLOS_ADDON_RATE_NOT_FOUND", "Price draft not found");
    const key = `schoolos-addon-rate:${initial.category}:${initial.code}`;
    await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext(${key}))`;
    const rate = await tx.schoolOSAddonRate.findUniqueOrThrow({ where: { id } });
    if (rate.status !== "DRAFT")
      throw new AppError(409, "SCHOOLOS_ADDON_RATE_NOT_DRAFT", "Only new draft pricing can be approved");
    if (rate.createdBy === req.auth!.userId)
      throw new AppError(403, "SCHOOLOS_ADDON_MAKER_CHECKER_REQUIRED", "Rate author cannot approve their own price");
    const others = await tx.schoolOSAddonRate.findMany({
      where: { category: rate.category, code: rate.code, status: "APPROVED", id: { not: id } },
    });
    if (others.some(item => schoolOSAddonWindowOverlaps(rate, item)))
      throw new AppError(409, "SCHOOLOS_ADDON_APPROVAL_WINDOW_CONFLICT", "Another approved version overlaps this rate period");
    const updated = await tx.schoolOSAddonRate.updateMany({
      where: { id, status: "DRAFT", approvedBy: null },
      data: { status: "APPROVED", approvedBy: req.auth!.userId, approvedAt: new Date(), approvalReference },
    });
    if (updated.count !== 1)
      throw new AppError(409, "SCHOOLOS_ADDON_APPROVAL_RACE", "Rate was concurrently approved");
    await tx.auditLog.create({
      data: { organizationId: "org_default", actorId: req.auth!.userId,
        action: "SCHOOLOS_ADDON_RATE_APPROVED", entity: "SchoolOSAddonRate", entityId: id,
        metadata: { approvalReference, reason, category: rate.category, code: rate.code,
          revision: rate.revision, unitPricePaise: rate.unitPricePaise } },
    });
    return tx.schoolOSAddonRate.findUniqueOrThrow({ where: { id } });
  });
  res.json({ data: saved, meta: { checkoutActivated: false } });
});

export default router;
