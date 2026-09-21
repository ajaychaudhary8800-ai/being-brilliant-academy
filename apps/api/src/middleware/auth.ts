import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";
import { env } from "../config.js";
import { AppError } from "../lib/http.js";
import { systemPrisma } from "../lib/prisma.js";
import { tenantContext } from "../lib/tenant-context.js";

export type AuthRequest = Request & { auth?: { userId: string; role: Role; organizationId: string; homeOrganizationId: string; billingRecovery?: boolean } };

function subscriptionActive(org: { isActive: boolean; deletedAt: Date | null; subscriptionStatus: string; trialEndsAt: Date | null; subscriptionEndsAt: Date | null } | null, now: Date) {
  return Boolean(org
    && org.isActive
    && !org.deletedAt
    && (org.subscriptionStatus === "ACTIVE" || org.subscriptionStatus === "TRIAL" && (!org.trialEndsAt || org.trialEndsAt > now))
    && (!org.subscriptionEndsAt || org.subscriptionEndsAt > now));
}

function billingRecoveryEligible(
  org: { isActive: boolean; deletedAt: Date | null; subscriptionStatus: string; trialEndsAt: Date | null; subscriptionEndsAt: Date | null } | null,
  role: Role,
  now: Date,
) {
  if (!org || !org.isActive || org.deletedAt || role !== Role.SUPER_ADMIN) return false;
  if (org.subscriptionStatus === "PAST_DUE") return true;
  if (org.subscriptionStatus === "ACTIVE" && org.subscriptionEndsAt && org.subscriptionEndsAt <= now) return true;
  return org.subscriptionStatus === "TRIAL" && Boolean(org.trialEndsAt && org.trialEndsAt <= now);
}

function billingRecoveryPathAllowed(req: Request) {
  const path = req.path;
  if (req.method === "GET" && path === "/api/v1/auth/me") return true;
  if (req.method === "GET" && path === "/api/v1/organization/entitlements") return true;
  if (req.method === "GET" && path === "/api/v1/organization/subscription") return true;
  if (req.method === "GET" && path === "/api/v1/organization/subscription/plans") return true;
  return req.method === "POST" && path === "/api/v1/organization/subscription/checkout";
}

export async function requireAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return next(new AppError(401, "UNAUTHENTICATED", "Sign in is required"));
  try {
    const claim = jwt.verify(token, env.JWT_ACCESS_SECRET) as { userId: string; role: Role; organizationId: string };
    if (!claim.organizationId) throw new AppError(401, "INVALID_TOKEN", "Token has no organization");

    const requested = req.header("x-organization-id");
    const platform = claim.role === Role.SUPER_ADMIN && claim.organizationId === "org_default";
    const target = platform && requested ? requested : claim.organizationId;
    const log = (allowed: boolean, reason?: string) => systemPrisma.tenantAccessAudit.create({
      data: { organizationId: target, userId: claim.userId, method: req.method, path: req.originalUrl, ipAddress: req.ip, userAgent: req.header("user-agent"), allowed, reason },
    }).catch(() => {});
    const user = await systemPrisma.user.findFirst({
      where: { id: claim.userId, organizationId: claim.organizationId },
      select: { isActive: true, role: true },
    });
    if (!user?.isActive) {
      void log(false, "USER_INACTIVE");
      throw new AppError(401, "INVALID_TOKEN", "Your session has expired");
    }
    if (user.role && user.role !== claim.role) {
      void log(false, "ROLE_CHANGED");
      throw new AppError(401, "STALE_ROLE_TOKEN", "Your access has changed. Sign in again.");
    }
    if (requested && !platform && requested !== claim.organizationId) {
      void log(false, "TENANT_MISMATCH");
      throw new AppError(403, "TENANT_MISMATCH", "Cross-organization access denied");
    }
    const org = await systemPrisma.organization.findUnique({ where: { id: target } });
    const now = new Date();
    const valid = subscriptionActive(org, now);
    const billingRecovery = !valid && !platform && billingRecoveryEligible(org, claim.role, now);
    if (!valid && (!billingRecovery || !billingRecoveryPathAllowed(req))) {
      void log(false, billingRecovery ? "BILLING_RECOVERY_ROUTE_BLOCKED" : "SUBSCRIPTION_INACTIVE");
      throw new AppError(402, "SUBSCRIPTION_INACTIVE", billingRecovery ? "Subscription renewal is required. Only billing access is available." : "Organization subscription is inactive");
    }
    req.auth = { userId: claim.userId, role: claim.role, organizationId: target, homeOrganizationId: claim.organizationId, billingRecovery };
    void log(true, billingRecovery ? "BILLING_RECOVERY_ALLOWED" : undefined);
    tenantContext.run({ organizationId: target, userId: claim.userId, role: claim.role }, next);
  } catch (error) {
    if (error instanceof AppError) return next(error);
    next(new AppError(401, "INVALID_TOKEN", "Your session has expired"));
  }
}

export const allow = (...roles: Role[]) => (req: AuthRequest, _res: Response, next: NextFunction) => !req.auth || !roles.includes(req.auth.role)
  ? next(new AppError(403, "FORBIDDEN", "You do not have permission for this action"))
  : next();
