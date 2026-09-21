import crypto from "node:crypto";
import { OrganizationSubscriptionStatus, Prisma, Role, SaaSBillingCycle } from "@prisma/client";
import bcrypt from "bcryptjs";
import { AppError } from "./http.js";
import { systemPrisma } from "./prisma.js";

export type TenantOrganizationProvisionInput = {
  organization: Prisma.OrganizationUncheckedCreateInput;
  admin: {
    name: string;
    email: string;
    password?: string | null;
  };
  actorId: string;
};

export async function provisionTenantOrganization(input: TenantOrganizationProvisionInput) {
  const planCode = String(input.organization.subscriptionPlan ?? "STANDARD").trim().toUpperCase();
  const plan = await systemPrisma.saaSPlan.findUnique({ where: { code: planCode } });
  if (!plan || !plan.isActive) {
    throw new AppError(422, "SAAS_PLAN_NOT_FOUND", "Select an active SaaS plan before provisioning the organization");
  }

  const now = new Date();
  const status = input.organization.subscriptionStatus ?? OrganizationSubscriptionStatus.TRIAL;
  let trialEndsAt = input.organization.trialEndsAt ? new Date(input.organization.trialEndsAt) : null;
  if (status === OrganizationSubscriptionStatus.TRIAL && !trialEndsAt && plan.trialDays > 0) {
    trialEndsAt = new Date(now.getTime() + plan.trialDays * 24 * 60 * 60 * 1000);
  }
  const subscriptionEndsAt = input.organization.subscriptionEndsAt ? new Date(input.organization.subscriptionEndsAt) : null;
  const periodEnd = status === OrganizationSubscriptionStatus.TRIAL ? trialEndsAt : subscriptionEndsAt;
  const generatedPassword = input.admin.password ?? crypto.randomBytes(48).toString("base64url");
  const passwordHash = await bcrypt.hash(generatedPassword, 12);

  try {
    return await systemPrisma.$transaction(async tx => {
      const organization = await tx.organization.create({
        data: {
          ...input.organization,
          subscriptionPlan: plan.code,
          subscriptionStatus: status,
          trialEndsAt,
          subscriptionEndsAt,
        },
      });
      const admin = await tx.user.create({
        data: {
          organizationId: organization.id,
          name: input.admin.name,
          email: input.admin.email,
          passwordHash,
          role: Role.SUPER_ADMIN,
          emailVerifiedAt: input.admin.password ? new Date() : null,
        },
      });
      const subscription = await tx.saaSSubscription.create({
        data: {
          organizationId: organization.id,
          planId: plan.id,
          status,
          billingCycle: SaaSBillingCycle.MONTHLY,
          currentPeriodStart: status === OrganizationSubscriptionStatus.TRIAL || status === OrganizationSubscriptionStatus.ACTIVE ? now : null,
          currentPeriodEnd: periodEnd,
        },
        include: { plan: true },
      });
      await tx.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: input.actorId,
          action: "ORGANIZATION_CREATED",
          entity: "Organization",
          entityId: organization.id,
          metadata: {
            slug: organization.slug,
            adminId: admin.id,
            planCode: plan.code,
            subscriptionStatus: status,
            trialEndsAt: trialEndsAt?.toISOString() ?? null,
          },
        },
      });
      return {
        organization,
        admin: { id: admin.id, organizationId: admin.organizationId, name: admin.name, email: admin.email },
        subscription,
      };
    }, { timeout: 10_000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(409, "ORGANIZATION_CONFLICT", "Organization slug or administrator email already exists");
    }
    throw error;
  }
}
