import { OrganizationSubscriptionStatus, Prisma, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { issueAccountSetup } from "../lib/account-setup.js";
import { AppError } from "../lib/http.js";
import { logger } from "../lib/logger.js";
import { provisionTenantOrganization } from "../lib/organization-provisioning.js";
import { systemPrisma } from "../lib/prisma.js";
import { storedImagePublicPrefix } from "../lib/stored-image.js";
import { customDomainFromSettings } from "../lib/tenant-domain.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { organizationBrandingSchema } from "../validation/organization.js";

const router = Router();
router.use(requireAuth);

const input = organizationBrandingSchema.extend({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/).min(2).max(80),
  subscriptionStatus: z.nativeEnum(OrganizationSubscriptionStatus).default(OrganizationSubscriptionStatus.TRIAL),
  subscriptionPlan: z.string().trim().toUpperCase().min(2).max(50).default("ESSENTIALS"),
  trialEndsAt: z.coerce.date().nullable().optional(),
  subscriptionEndsAt: z.coerce.date().nullable().optional(),
  adminName: z.string().trim().min(2).max(100),
  adminEmail: z.string().trim().toLowerCase().email(),
  adminPassword: z.string().min(10).max(128).optional(),
  sendSetupEmail: z.boolean().optional(),
});

const onboardingProgress = z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETE", "NOT_REQUIRED"]);
const onboardingUpdate = z.object({
  dataMigration: onboardingProgress.optional(),
  training: onboardingProgress.optional(),
  targetGoLiveDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  goLiveApproved: z.boolean().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).strict();

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function clientOnboarding(settings: unknown) {
  const raw = record(record(settings).clientOnboarding);
  const progress = (value: unknown) => onboardingProgress.safeParse(value).success ? value as z.infer<typeof onboardingProgress> : "NOT_STARTED";
  return {
    dataMigration: progress(raw.dataMigration),
    training: progress(raw.training),
    targetGoLiveDate: typeof raw.targetGoLiveDate === "string" ? raw.targetGoLiveDate : null,
    goLiveApproved: raw.goLiveApproved === true,
    notes: typeof raw.notes === "string" ? raw.notes : null,
  };
}

async function onboardingSnapshot(organizationId: string) {
  const [organization, admin, activeBranches] = await Promise.all([
    systemPrisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        slug: true,
        name: true,
        isActive: true,
        deletedAt: true,
        settings: true,
        subscriptionStatus: true,
        subscriptionPlan: true,
        trialEndsAt: true,
        subscriptionEndsAt: true,
        saasSubscription: {
          select: {
            status: true,
            currentPeriodEnd: true,
            plan: { select: { code: true, name: true, isActive: true } },
          },
        },
      },
    }),
    systemPrisma.user.findFirst({
      where: { organizationId, role: Role.SUPER_ADMIN, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, email: true, emailVerifiedAt: true },
    }),
    systemPrisma.branch.count({ where: { organizationId, isActive: true } }),
  ]);

  if (!organization || organization.deletedAt) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found");

  const now = new Date();
  const onboarding = clientOnboarding(organization.settings);
  const subscriptionAccessValid =
    (organization.subscriptionStatus === OrganizationSubscriptionStatus.ACTIVE
      || organization.subscriptionStatus === OrganizationSubscriptionStatus.TRIAL && (!organization.trialEndsAt || organization.trialEndsAt > now))
    && (!organization.subscriptionEndsAt || organization.subscriptionEndsAt > now);
  const subscriptionAligned = Boolean(
    organization.saasSubscription
    && organization.saasSubscription.status === organization.subscriptionStatus
    && organization.saasSubscription.plan.code === organization.subscriptionPlan,
  );
  const dataReady = onboarding.dataMigration === "COMPLETE" || onboarding.dataMigration === "NOT_REQUIRED";
  const trainingReady = onboarding.training === "COMPLETE" || onboarding.training === "NOT_REQUIRED";

  const checks = [
    { key: "organization", label: "Organization active", complete: organization.isActive, required: true },
    { key: "subscription", label: "Subscription active and ledger aligned", complete: subscriptionAccessValid && subscriptionAligned, required: true },
    { key: "admin", label: "Administrator account activated", complete: Boolean(admin?.emailVerifiedAt), required: true },
    { key: "branch", label: "At least one active branch/campus created", complete: activeBranches > 0, required: true },
    { key: "data", label: "Initial data migration completed or not required", complete: dataReady, required: true },
    { key: "training", label: "Client training completed or not required", complete: trainingReady, required: true },
    { key: "approval", label: "Go-live approved", complete: onboarding.goLiveApproved, required: true },
  ];
  const completed = checks.filter(item => item.complete).length;
  const blocked = !organization.isActive || !subscriptionAccessValid || !subscriptionAligned || !admin;
  const customDomain = customDomainFromSettings(organization.settings);

  return {
    organization: {
      id: organization.id,
      slug: organization.slug,
      name: organization.name,
      subscriptionStatus: organization.subscriptionStatus,
      subscriptionPlan: organization.subscriptionPlan,
    },
    administrator: admin,
    activeBranches,
    onboarding,
    access: {
      sharedPath: `/login/admin?workspace=${organization.slug}`,
      customDomain: customDomain ? `https://${customDomain}` : null,
    },
    subscription: {
      valid: subscriptionAccessValid,
      aligned: subscriptionAligned,
      plan: organization.saasSubscription?.plan ?? null,
    },
    checklist: checks,
    readiness: {
      completed,
      total: checks.length,
      percent: Math.round(completed / checks.length * 100),
      readyForGoLive: completed === checks.length,
      status: blocked ? "BLOCKED" : completed === checks.length ? "READY" : "IN_PROGRESS",
    },
  };
}

function platform(req: AuthRequest) {
  if (req.auth!.role !== Role.SUPER_ADMIN || req.auth!.homeOrganizationId !== "org_default") {
    throw new AppError(403, "PLATFORM_ADMIN_REQUIRED", "Platform super administrator access required");
  }
}


async function requireUniqueCustomDomain(settings: unknown) {
  const domain = customDomainFromSettings(settings, true);
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

router.get("/platform/organizations/:id/onboarding", async (req: AuthRequest, res) => {
  platform(req);
  res.json({ data: await onboardingSnapshot(String(req.params.id)) });
});

router.patch("/platform/organizations/:id/onboarding", async (req: AuthRequest, res) => {
  platform(req);
  const organizationId = String(req.params.id);
  const data = onboardingUpdate.parse(req.body);
  const organization = await systemPrisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: { id: true, settings: true },
  });
  if (!organization) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found");

  const settings = record(organization.settings);
  const current = clientOnboarding(settings);
  const next = {
    ...current,
    ...data,
    ...(data.notes === undefined ? {} : { notes: data.notes || null }),
    ...(data.targetGoLiveDate === undefined ? {} : { targetGoLiveDate: data.targetGoLiveDate }),
  };

  await systemPrisma.$transaction([
    systemPrisma.organization.update({
      where: { id: organizationId },
      data: {
        settings: {
          ...settings,
          clientOnboarding: next,
        } as Prisma.InputJsonValue,
      },
    }),
    systemPrisma.auditLog.create({
      data: {
        organizationId,
        actorId: req.auth!.userId,
        action: "CLIENT_ONBOARDING_UPDATED",
        entity: "Organization",
        entityId: organizationId,
        metadata: next,
      },
    }),
  ]);

  res.json({ data: await onboardingSnapshot(organizationId) });
});

export default router;
