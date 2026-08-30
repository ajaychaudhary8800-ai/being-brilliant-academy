import { OrganizationSubscriptionStatus, Prisma, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/http.js";
import { systemPrisma } from "../lib/prisma.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { organizationBrandingSchema } from "../validation/organization.js";
import { storedImagePublicPrefix } from "../lib/stored-image.js";

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
  adminPassword: z.string().min(10).max(128),
});

router.post("/platform/organizations", async (req: AuthRequest, res) => {
  if (req.auth!.role !== Role.SUPER_ADMIN || req.auth!.homeOrganizationId !== "org_default") throw new AppError(403, "PLATFORM_ADMIN_REQUIRED", "Platform super administrator access required");
  const data = input.parse(req.body);
  let logoPath = data.logoUrl ?? "";
  try { if (/^https?:\/\//i.test(logoPath)) logoPath = new URL(logoPath).pathname; } catch { logoPath = ""; }
  if (logoPath.startsWith(storedImagePublicPrefix)) throw new AppError(422, "INVALID_LOGO_REFERENCE", "Upload the logo after the organization has been created");
  const [slug, email] = await Promise.all([systemPrisma.organization.findUnique({ where: { slug: data.slug }, select: { id: true } }), systemPrisma.user.findUnique({ where: { email: data.adminEmail }, select: { id: true } })]);
  if (slug) throw new AppError(409, "SLUG_EXISTS", "Organization slug already exists");
  if (email) throw new AppError(409, "EMAIL_EXISTS", "Administrator email already exists");
  // Hashing is deliberately outside the interactive transaction to avoid a
  // transaction timeout while retaining atomic database provisioning.
  const passwordHash = await bcrypt.hash(data.adminPassword, 12);
  const { adminName, adminEmail, adminPassword: _password, ...organizationData } = data;
  try {
    const result = await systemPrisma.$transaction(async tx => {
      const organization = await tx.organization.create({ data: organizationData });
      const admin = await tx.user.create({ data: { organizationId: organization.id, name: adminName, email: adminEmail, passwordHash, role: Role.SUPER_ADMIN, emailVerifiedAt: new Date() } });
      await tx.auditLog.create({ data: { organizationId: organization.id, actorId: req.auth!.userId, action: "ORGANIZATION_CREATED", entity: "Organization", entityId: organization.id, metadata: { slug: organization.slug, adminId: admin.id } } });
      return { organization, admin: { id: admin.id, name: admin.name, email: admin.email } };
    }, { timeout: 10_000 });
    res.status(201).json({ data: result });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new AppError(409, "ORGANIZATION_CONFLICT", "Organization slug or administrator email already exists");
    throw error;
  }
});

export default router;
