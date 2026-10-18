import { Prisma, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/http.js";
import { systemPrisma } from "../lib/prisma.js";
import {
  isSchoolOSFeature,
  readSchoolOSFeatureOverrides,
  schoolOSFeatureAccess,
  schoolOSFeatures,
} from "../lib/schoolos-feature-policy.js";
import { commercialAccessSnapshot } from "../lib/saas-commercial.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function requirePlatformAdmin(req: AuthRequest) {
  if (req.auth?.role !== Role.SUPER_ADMIN || req.auth.homeOrganizationId !== "org_default") {
    throw new AppError(403, "PLATFORM_ADMIN_REQUIRED", "Platform super administrator access required");
  }
}

const changeInput = z.object({
  enabled: z.boolean().nullable(),
  reason: z.string().trim().min(10).max(500),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
}).strict();

router.get("/platform/schoolos/features", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  res.json({ data: schoolOSFeatures });
});

router.get("/platform/schoolos/organizations/:organizationId/features", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const organizationId = String(req.params.organizationId);
  const snapshot = await commercialAccessSnapshot(organizationId);
  const settings = object(snapshot.organization.settings);
  const commercial = object(settings.commercialEntitlements);
  const overrides = readSchoolOSFeatureOverrides(commercial.featureOverrides);
  const entitlements = snapshot.plan?.entitlements ?? {};
  const data = schoolOSFeatures.map(feature => {
    const includedInPlan = entitlements["*"] === true || entitlements[feature.key] === true;
    const access = schoolOSFeatureAccess(entitlements, snapshot.enforcementEnabled, overrides, feature.key);
    return { ...feature, includedInPlan, enabled: access.enabled, source: access.source, override: overrides[feature.key] ?? null };
  });
  res.json({ data: { organizationId, name: snapshot.organization.id === "org_default" ? "Platform" : await systemPrisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }).then(o => o?.name ?? ""), planCode: snapshot.plan?.code ?? snapshot.organization.subscriptionPlan, enforcementEnabled: snapshot.enforcementEnabled, features: data } });
});

router.patch("/platform/schoolos/organizations/:organizationId/features/:feature", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const organizationId = String(req.params.organizationId);
  const feature = String(req.params.feature);
  if (!isSchoolOSFeature(feature)) throw new AppError(404, "SCHOOLOS_FEATURE_NOT_FOUND", "Unknown SchoolOS feature");
  const change = changeInput.parse(req.body);
  const now = new Date();

  const updated = await systemPrisma.$transaction(async tx => {
    // Serialize edits to the tenant's JSON settings to prevent lost feature changes.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"schoolos-features:" + organizationId}))`;
    const organization = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, deletedAt: true, settings: true, subscriptionPlan: true, saasSubscription: { include: { plan: true } } },
    });
    if (!organization || organization.deletedAt) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found");
    if (organizationId === "org_default") throw new AppError(422, "PLATFORM_FEATURE_OVERRIDE_FORBIDDEN", "Platform control organization cannot be re-licensed");
    const plan = organization.saasSubscription?.plan
      ?? await tx.saaSPlan.findUnique({ where: { code: organization.subscriptionPlan } });
    const base = object(plan?.entitlements);
    const includedInPlan = base["*"] === true || base[feature] === true;
    if (change.enabled === true && !includedInPlan) {
      const expiry = change.expiresAt ? new Date(change.expiresAt).getTime() : NaN;
      const maximum = now.getTime() + 60 * 24 * 60 * 60 * 1000;
      if (!Number.isFinite(expiry) || expiry <= now.getTime() || expiry > maximum) {
        throw new AppError(422, "SCHOOLOS_TRIAL_EXPIRY_REQUIRED", "Unpurchased feature grants require a future expiry within 60 days. Paid upgrades must use an approved subscription.");
      }
    }
    if (change.expiresAt !== undefined && change.expiresAt !== null && new Date(change.expiresAt).getTime() <= now.getTime()) {
      throw new AppError(422, "SCHOOLOS_FEATURE_EXPIRY_PAST", "Feature expiry must be in the future");
    }

    const settings = object(organization.settings);
    const commercial = object(settings.commercialEntitlements);
    const overrides = readSchoolOSFeatureOverrides(commercial.featureOverrides);
    if (change.enabled === null) delete overrides[feature];
    else overrides[feature] = {
      enabled: change.enabled,
      reason: change.reason,
      expiresAt: change.expiresAt ?? null,
      changedBy: req.auth!.userId,
      changedAt: now.toISOString(),
    };
    await tx.organization.update({
      where: { id: organizationId },
      data: { settings: { ...settings, commercialEntitlements: { ...commercial, featureOverrides: overrides } } as Prisma.InputJsonValue },
    });
    await tx.auditLog.create({
      data: {
        organizationId,
        actorId: req.auth!.userId,
        action: "SCHOOLOS_CLIENT_FEATURE_CHANGED",
        entity: "Organization",
        entityId: organizationId,
        metadata: { feature, enabled: change.enabled, expiresAt: change.expiresAt ?? null, reason: change.reason, planCode: plan?.code ?? organization.subscriptionPlan },
      },
    });
    return { feature, override: overrides[feature] ?? null };
  });
  res.json({ data: updated });
});

export default router;
