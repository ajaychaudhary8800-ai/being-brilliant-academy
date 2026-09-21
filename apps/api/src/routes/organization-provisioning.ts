import { OrganizationSubscriptionStatus, Prisma, Role } from "@prisma/client";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/http.js";
import { systemPrisma } from "../lib/prisma.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { organizationBrandingSchema } from "../validation/organization.js";
import { storedImagePublicPrefix } from "../lib/stored-image.js";
import { issueAccountSetup } from "../lib/account-setup.js";

const router = Router();
router.use(requireAuth);
const input = organizationBrandingSchema.extend({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/).min(2).max(80),
  subscriptionStatus: z.nativeEnum(OrganizationSubscriptionStatus).default(OrganizationSubscriptionStatus.TRIAL),
  subscriptionPlan: z.string().trim().min(2).max(50).default("STANDARD"),
  trialEndsAt: z.coerce.date().nullable().optional(),
  subscriptionEndsAt: z.coerce.date().nullable().optional(),
  adminName: z.string().trim().min(2).max(100),
  adminEmail: z.string().trim().toLowerCase().email(),
});

function requirePlatformAdmin(req: AuthRequest) {
  if (req.auth!.role !== Role.SUPER_ADMIN || req.auth!.homeOrganizationId !== "org_default") {
    throw new AppError(403, "PLATFORM_ADMIN_REQUIRED", "Platform super administrator access required");
  }
}

async function deliverTenantAdminSetup(req: AuthRequest, admin: { id: string; organizationId: string; email: string; name: string }) {
  try {
    const delivery = await issueAccountSetup(admin);
    const result = { sent: !delivery.skipped, skipped: delivery.skipped, reason: delivery.skipped ? delivery.reason : null };
    await systemPrisma.auditLog.create({
      data: {
        organizationId: admin.organizationId,
        actorId: req.auth!.userId,
        action: "TENANT_ADMIN_SETUP_REQUESTED",
        entity: "User",
        entityId: admin.id,
        metadata: { delivery: result.sent ? "SENT" : "SKIPPED", reason: result.reason },
      },
    });
    return result;
  } catch {
    await systemPrisma.auditLog.create({
      data: {
        organizationId: admin.organizationId,
        actorId: req.auth!.userId,
        action: "TENANT_ADMIN_SETUP_REQUESTED",
        entity: "User",
        entityId: admin.id,
        metadata: { delivery: "FAILED" },
      },
    }).catch(() => undefined);
    return { sent: false, skipped: true, reason: "EMAIL_DELIVERY_FAILED" } as const;
  }
}

router.post("/platform/organizations", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const data = input.parse(req.body);
  let logoPath = data.logoUrl ?? "";
  try { if (/^https?:\/\//i.test(logoPath)) logoPath = new URL(logoPath).pathname; } catch { logoPath = ""; }
  if (logoPath.startsWith(storedImagePublicPrefix)) throw new AppError(422, "INVALID_LOGO_REFERENCE", "Upload the logo after the organization has been created");
  const [slug, email] = await Promise.all([systemPrisma.organization.findUnique({ where: { slug: data.slug }, select: { id: true } }), systemPrisma.user.findUnique({ where: { email: data.adminEmail }, select: { id: true } })]);
  if (slug) throw new AppError(409, "SLUG_EXISTS", "Organization slug already exists");
  if (email) throw new AppError(409, "EMAIL_EXISTS", "Administrator email already exists");
  // Hashing is deliberately outside the interactive transaction to avoid a
  // transaction timeout while retaining atomic database provisioning.
  const passwordHash = await bcrypt.hash(crypto.randomBytes(48).toString("base64url"), 12);
  const { adminName, adminEmail, ...organizationData } = data;
  try {
    const result = await systemPrisma.$transaction(async tx => {
      const organization = await tx.organization.create({ data: organizationData });
      const admin = await tx.user.create({ data: { organizationId: organization.id, name: adminName, email: adminEmail, passwordHash, role: Role.SUPER_ADMIN } });
      await tx.auditLog.create({ data: { organizationId: organization.id, actorId: req.auth!.userId, action: "ORGANIZATION_CREATED", entity: "Organization", entityId: organization.id, metadata: { slug: organization.slug, adminId: admin.id } } });
      return { organization, admin: { id: admin.id, organizationId: organization.id, name: admin.name, email: admin.email } };
    }, { timeout: 10_000 });
    const setup = await deliverTenantAdminSetup(req, result.admin);
    res.status(201).json({ data: { ...result, setup } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new AppError(409, "ORGANIZATION_CONFLICT", "Organization slug or administrator email already exists");
    throw error;
  }
});

router.post("/platform/organizations/:organizationId/admin-setup-email", async (req: AuthRequest, res) => {
  requirePlatformAdmin(req);
  const organizationId = String(req.params.organizationId);
  const input = z.object({ adminEmail: z.string().trim().toLowerCase().email().optional() }).parse(req.body ?? {});
  const organization = await systemPrisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, deletedAt: true },
  });
  if (!organization || organization.deletedAt) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found");

  const admins = await systemPrisma.user.findMany({
    where: {
      organizationId,
      role: Role.SUPER_ADMIN,
      isActive: true,
      ...(input.adminEmail ? { email: input.adminEmail } : {}),
    },
    select: { id: true, organizationId: true, name: true, email: true },
    orderBy: { createdAt: "asc" },
    take: 2,
  });
  if (!admins.length) throw new AppError(404, "TENANT_ADMIN_NOT_FOUND", "No active tenant administrator was found");
  if (!input.adminEmail && admins.length > 1) {
    throw new AppError(409, "TENANT_ADMIN_SELECTION_REQUIRED", "Multiple tenant administrators exist; provide the administrator email");
  }

  const setup = await deliverTenantAdminSetup(req, admins[0]!);
  res.status(202).json({ data: { admin: { id: admins[0]!.id, email: admins[0]!.email }, setup } });
});

export default router;
