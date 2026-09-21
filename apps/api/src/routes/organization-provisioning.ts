import { OrganizationSubscriptionStatus, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { issueAccountSetup } from "../lib/account-setup.js";
import { AppError } from "../lib/http.js";
import { logger } from "../lib/logger.js";
import { provisionTenantOrganization } from "../lib/organization-provisioning.js";
import { systemPrisma } from "../lib/prisma.js";
import { storedImagePublicPrefix } from "../lib/stored-image.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { organizationBrandingSchema } from "../validation/organization.js";

const router = Router();
router.use(requireAuth);

const input = organizationBrandingSchema.extend({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/).min(2).max(80),
  subscriptionStatus: z.nativeEnum(OrganizationSubscriptionStatus).default(OrganizationSubscriptionStatus.TRIAL),
  subscriptionPlan: z.string().trim().toUpperCase().min(2).max(50).default("STANDARD"),
  trialEndsAt: z.coerce.date().nullable().optional(),
  subscriptionEndsAt: z.coerce.date().nullable().optional(),
  adminName: z.string().trim().min(2).max(100),
  adminEmail: z.string().trim().toLowerCase().email(),
  adminPassword: z.string().min(10).max(128).optional(),
  sendSetupEmail: z.boolean().optional(),
});

function platform(req: AuthRequest) {
  if (req.auth!.role !== Role.SUPER_ADMIN || req.auth!.homeOrganizationId !== "org_default") {
    throw new AppError(403, "PLATFORM_ADMIN_REQUIRED", "Platform super administrator access required");
  }
}

function settingsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function customDomain(settings: unknown) {
  const whiteLabel = settingsRecord(settingsRecord(settings).whiteLabel);
  const raw = typeof whiteLabel.customDomain === "string" ? whiteLabel.customDomain.trim().toLowerCase() : "";
  if (!raw) return null;
  const normalized = raw.replace(/^https?:\/\//, "").split("/")[0]?.replace(/:\d+$/, "").replace(/\.$/, "") ?? "";
  if (raw !== normalized || !/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(normalized)) {
    throw new AppError(422, "INVALID_CUSTOM_DOMAIN", "Enter a normalized custom domain such as erp.school.com without protocol or path");
  }
  return normalized;
}

async function requireUniqueCustomDomain(settings: unknown) {
  const domain = customDomain(settings);
  if (!domain) return;
  const duplicate = await systemPrisma.organization.findFirst({
    where: {
      deletedAt: null,
      settings: { path: ["whiteLabel", "customDomain"], equals: domain },
    },
    select: { id: true },
  });
  if (duplicate) throw new AppError(409, "CUSTOM_DOMAIN_EXISTS", "This custom domain is already assigned to another organization");
}

router.post("/platform/organizations", async (req: AuthRequest, res) => {
  platform(req);
  const data = input.parse(req.body);
  const setupRequested = data.sendSetupEmail ?? !data.adminPassword;
  if (!data.adminPassword && !setupRequested) {
    throw new AppError(422, "ADMIN_ACCESS_METHOD_REQUIRED", "Provide an administrator password or enable secure setup email");
  }

  let logoPath = data.logoUrl ?? "";
  try {
    if (/^https?:\/\//i.test(logoPath)) logoPath = new URL(logoPath).pathname;
  } catch {
    logoPath = "";
  }
  if (logoPath.startsWith(storedImagePublicPrefix)) {
    throw new AppError(422, "INVALID_LOGO_REFERENCE", "Upload the logo after the organization has been created");
  }

  const [slug, email] = await Promise.all([
    systemPrisma.organization.findUnique({ where: { slug: data.slug }, select: { id: true } }),
    systemPrisma.user.findUnique({ where: { email: data.adminEmail }, select: { id: true } }),
  ]);
  if (slug) throw new AppError(409, "SLUG_EXISTS", "Organization slug already exists");
  if (email) throw new AppError(409, "EMAIL_EXISTS", "Administrator email already exists");
  await requireUniqueCustomDomain(data.settings);

  const {
    adminName,
    adminEmail,
    adminPassword,
    sendSetupEmail: _sendSetupEmail,
    ...organizationData
  } = data;

  const result = await provisionTenantOrganization({
    organization: organizationData,
    admin: { name: adminName, email: adminEmail, password: adminPassword ?? null },
    actorId: req.auth!.userId,
  });

  let setupDelivery: Record<string, unknown> = { requested: setupRequested };
  if (setupRequested) {
    try {
      const delivery = await issueAccountSetup(result.admin);
      setupDelivery = { requested: true, ...delivery };
      await systemPrisma.auditLog.create({
        data: {
          organizationId: result.organization.id,
          actorId: req.auth!.userId,
          action: "ORGANIZATION_ADMIN_SETUP_EMAIL_ISSUED",
          entity: "User",
          entityId: result.admin.id,
          metadata: { email: result.admin.email, skipped: delivery.skipped },
        },
      });
    } catch (error) {
      logger.error({ err: error, organizationId: result.organization.id, userId: result.admin.id }, "Organization created but setup email delivery failed");
      setupDelivery = { requested: true, skipped: true, reason: "SETUP_EMAIL_FAILED" };
    }
  }

  res.status(201).json({ data: { ...result, setupDelivery } });
});

router.post("/platform/organizations/:id/admin/setup-email", async (req: AuthRequest, res) => {
  platform(req);
  const organizationId = String(req.params.id);
  const organization = await systemPrisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null, isActive: true },
    select: { id: true, name: true },
  });
  if (!organization) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found");

  const admin = await systemPrisma.user.findFirst({
    where: { organizationId, role: Role.SUPER_ADMIN, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, organizationId: true, name: true, email: true },
  });
  if (!admin) throw new AppError(404, "ORGANIZATION_ADMIN_NOT_FOUND", "No active organization Super Admin was found");

  let delivery;
  try {
    delivery = await issueAccountSetup(admin);
  } catch (error) {
    logger.error({ err: error, organizationId, userId: admin.id }, "Unable to resend organization administrator setup email");
    throw new AppError(502, "SETUP_EMAIL_FAILED", "Unable to send the setup email. Check the email provider and retry.");
  }

  await systemPrisma.auditLog.create({
    data: {
      organizationId,
      actorId: req.auth!.userId,
      action: "ORGANIZATION_ADMIN_SETUP_EMAIL_REISSUED",
      entity: "User",
      entityId: admin.id,
      metadata: { email: admin.email, skipped: delivery.skipped },
    },
  });
  res.status(202).json({ data: { organization, admin, delivery } });
});

export default router;
