import "express-async-errors";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { OrganizationSubscriptionStatus, Role } from "@prisma/client";
import express from "express";
import jwt from "jsonwebtoken";
import { env } from "../config.js";
import { errorHandler } from "../lib/http.js";
import { systemPrisma } from "../lib/prisma.js";
import admin from "../routes/admin.js";
import organizationProvisioning from "../routes/organization-provisioning.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";

function assertSafeTarget() {
  const configured = process.env.TEST_DATABASE_URL;
  let parsed: URL | null = null;
  try { parsed = configured ? new URL(configured) : null; } catch { parsed = null; }
  const name = parsed?.pathname.replace(/^\//, "") ?? "";
  if (
    !configured
    || process.env.DATABASE_URL !== configured
    || !parsed
    || !["postgres:", "postgresql:"].includes(parsed.protocol)
    || !new Set(["localhost", "127.0.0.1", "::1"]).has(parsed.hostname)
    || !/(^|[_-])(test|integration)([_-]|$)/i.test(name)
  ) {
    throw new Error("Refusing client-onboarding dry run outside a local TEST_DATABASE_URL");
  }
}

async function request(
  port: number,
  path: string,
  bearer: string,
  options: { method?: string; body?: unknown } = {},
) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${bearer}`,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) as any : null,
  };
}

test("real PostgreSQL completes the full client onboarding dry run to READY / 100%", { skip: !enabled, timeout: 120_000 }, async () => {
  assertSafeTarget();

  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const slug = `client-dryrun-${suffix}`;
  const planCode = `DRYRUN_${suffix.toUpperCase()}`;
  const tenantAdminEmail = `client-admin-${suffix}@example.test`;
  const managerEmail = `branch-manager-${suffix}@example.test`;
  const platformEmail = `platform-dryrun-${suffix}@example.test`;
  const otherOrganizationId = `client-dryrun-other-${suffix}`;

  let server: Server | undefined;
  let platformUserId: string | undefined;
  let organizationId: string | undefined;
  let tenantAdminId: string | undefined;
  let branchId: string | undefined;
  let managerUserId: string | undefined;

  try {
    const platformOrganization = await systemPrisma.organization.findUnique({
      where: { id: "org_default" },
      select: {
        id: true,
        isActive: true,
        deletedAt: true,
        subscriptionStatus: true,
        trialEndsAt: true,
        subscriptionEndsAt: true,
      },
    });
    assert.ok(platformOrganization, "fresh migration database must contain org_default");
    assert.equal(platformOrganization.isActive, true);
    assert.equal(platformOrganization.deletedAt, null);

    const platformUser = await systemPrisma.user.create({
      data: {
        organizationId: "org_default",
        email: platformEmail,
        passwordHash: "integration-only",
        name: "Client Dry Run Platform Admin",
        role: Role.SUPER_ADMIN,
        emailVerifiedAt: new Date(),
      },
    });
    platformUserId = platformUser.id;

    await systemPrisma.saaSPlan.create({
      data: {
        code: planCode,
        name: "Client Dry Run Plan",
        description: "Integration-only plan for the onboarding dry run",
        monthlyPricePaise: 100_000,
        annualPricePaise: 1_000_000,
        trialDays: 14,
        currency: "INR",
        taxRateBps: 1800,
        entitlements: { "*": true },
        limits: { branches: 2, users: 25, students: 500 },
        isActive: true,
      },
    });

    const application = express();
    application.use(express.json());
    application.use("/api/v1", organizationProvisioning);
    application.use("/api/v1/admin", admin);
    application.use(errorHandler);

    server = application.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server!.once("listening", resolve);
      server!.once("error", reject);
    });
    const port = (server.address() as AddressInfo).port;

    const platformToken = jwt.sign(
      { userId: platformUser.id, role: Role.SUPER_ADMIN, organizationId: "org_default" },
      env.JWT_ACCESS_SECRET,
      { expiresIn: "5m" },
    );

    const provisioned = await request(port, "/api/v1/platform/organizations", platformToken, {
      method: "POST",
      body: {
        name: "Client Dry Run Academy",
        legalName: "Client Dry Run Academy Private Limited",
        email: `client-${suffix}@example.test`,
        phone: "9876543210",
        primaryColor: "#14532D",
        secondaryColor: "#0F172A",
        timezone: "Asia/Kolkata",
        locale: "en-IN",
        currency: "INR",
        academicYearStartMonth: 4,
        slug,
        subscriptionStatus: OrganizationSubscriptionStatus.ACTIVE,
        subscriptionPlan: planCode,
        subscriptionEndsAt: "2030-03-31T23:59:59.000Z",
        adminName: "Dry Run Client Admin",
        adminEmail: tenantAdminEmail,
        adminPassword: "DryRun-Admin-123!",
        sendSetupEmail: false,
        settings: {},
      },
    });

    assert.equal(provisioned.status, 201, JSON.stringify(provisioned.body));
    organizationId = provisioned.body.data.organization.id;
    tenantAdminId = provisioned.body.data.admin.id;
    assert.equal(provisioned.body.data.organization.slug, slug);
    assert.equal(provisioned.body.data.subscription.plan.code, planCode);
    assert.equal(provisioned.body.data.subscription.status, OrganizationSubscriptionStatus.ACTIVE);

    const tenantToken = jwt.sign(
      { userId: tenantAdminId, role: Role.SUPER_ADMIN, organizationId },
      env.JWT_ACCESS_SECRET,
      { expiresIn: "5m" },
    );

    const initial = await request(port, `/api/v1/platform/organizations/${organizationId}/onboarding`, platformToken);
    assert.equal(initial.status, 200, JSON.stringify(initial.body));
    assert.equal(initial.body.data.readiness.status, "IN_PROGRESS");
    assert.equal(initial.body.data.readiness.percent, 43);
    assert.equal(initial.body.data.access.sharedPath, `/login/admin?workspace=${slug}`);
    assert.equal(initial.body.data.subscription.valid, true);
    assert.equal(initial.body.data.subscription.aligned, true);
    assert.equal(initial.body.data.administrator.email, tenantAdminEmail);
    assert.equal(initial.body.data.activeBranches, 0);

    const branch = await request(port, "/api/v1/admin/branches", tenantToken, {
      method: "POST",
      body: {
        branchCode: `DR-${suffix.slice(0, 6).toUpperCase()}`,
        branchName: "Main Campus",
        address: "101 Dry Run Road",
        city: "Ghaziabad",
        state: "Uttar Pradesh",
        pincode: "201001",
        phone: "9876543210",
        email: `campus-${suffix}@example.test`,
        managerName: "Dry Run Branch Manager",
        managerEmail,
        openingDate: "2026-04-01",
        isActive: true,
      },
    });

    assert.equal(branch.status, 201, JSON.stringify(branch.body));
    branchId = branch.body.data.id;
    managerUserId = branch.body.data.managerUserId;
    assert.ok(managerUserId);
    assert.equal(branch.body.data.branchName, "Main Campus");

    await systemPrisma.organization.create({
      data: {
        id: otherOrganizationId,
        slug: otherOrganizationId,
        name: "Other Dry Run Tenant",
        email: `${otherOrganizationId}@example.test`,
        subscriptionStatus: OrganizationSubscriptionStatus.ACTIVE,
      },
    });
    const otherBranch = await systemPrisma.branch.create({
      data: {
        organizationId: otherOrganizationId,
        branchCode: `OT-${suffix.slice(0, 6).toUpperCase()}`,
        branchName: "Other Tenant Campus",
        isActive: true,
      },
    });

    const tenantBranches = await request(port, "/api/v1/admin/branches?limit=100", tenantToken);
    assert.equal(tenantBranches.status, 200, JSON.stringify(tenantBranches.body));
    assert.ok(tenantBranches.body.data.some((item: any) => item.id === branchId));
    assert.ok(!tenantBranches.body.data.some((item: any) => item.id === otherBranch.id), "tenant branch listing leaked a branch from another organization");
    assert.ok(tenantBranches.body.data.every((item: any) => item.id !== otherBranch.id));

    const completed = await request(port, `/api/v1/platform/organizations/${organizationId}/onboarding`, platformToken, {
      method: "PATCH",
      body: {
        dataMigration: "NOT_REQUIRED",
        training: "COMPLETE",
        targetGoLiveDate: "2026-10-01",
        goLiveApproved: true,
        notes: "Automated Step 7 client onboarding dry run.",
      },
    });

    assert.equal(completed.status, 200, JSON.stringify(completed.body));
    assert.equal(completed.body.data.readiness.status, "READY");
    assert.equal(completed.body.data.readiness.readyForGoLive, true);
    assert.equal(completed.body.data.readiness.percent, 100);
    assert.equal(completed.body.data.readiness.completed, 7);
    assert.equal(completed.body.data.readiness.total, 7);
    assert.equal(completed.body.data.activeBranches, 1);
    assert.equal(completed.body.data.onboarding.dataMigration, "NOT_REQUIRED");
    assert.equal(completed.body.data.onboarding.training, "COMPLETE");
    assert.equal(completed.body.data.onboarding.goLiveApproved, true);

    const forbiddenPlatformRead = await request(
      port,
      `/api/v1/platform/organizations/${organizationId}/onboarding`,
      tenantToken,
    );
    assert.equal(forbiddenPlatformRead.status, 403);
    assert.equal(forbiddenPlatformRead.body.error.code, "PLATFORM_ADMIN_REQUIRED");

    assert.equal(await systemPrisma.auditLog.count({
      where: { organizationId, action: "ORGANIZATION_CREATED" },
    }), 1);
    assert.equal(await systemPrisma.auditLog.count({
      where: { organizationId, action: "BRANCH_CREATED", entityId: branchId },
    }), 1);
    assert.equal(await systemPrisma.auditLog.count({
      where: { organizationId, action: "CLIENT_ONBOARDING_UPDATED" },
    }), 1);
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));

    if (organizationId) {
      await systemPrisma.tenantAccessAudit.deleteMany({ where: { organizationId } });
      await systemPrisma.passwordResetToken.deleteMany({ where: { organizationId } });
      await systemPrisma.branchUser.deleteMany({ where: { organizationId } });
      await systemPrisma.session.deleteMany({ where: { organizationId } });
      await systemPrisma.auditLog.deleteMany({ where: { organizationId } });
      await systemPrisma.branch.deleteMany({ where: { organizationId } });
      await systemPrisma.saaSSubscription.deleteMany({ where: { organizationId } });
      await systemPrisma.user.deleteMany({ where: { organizationId } });
      await systemPrisma.$executeRawUnsafe('ALTER TABLE "AcademicSession" DISABLE TRIGGER "AcademicSession_exactly_one_current"');
      try {
        await systemPrisma.academicSession.deleteMany({ where: { organizationId } });
        await systemPrisma.organization.deleteMany({ where: { id: organizationId } });
      } finally {
        await systemPrisma.$executeRawUnsafe('ALTER TABLE "AcademicSession" ENABLE TRIGGER "AcademicSession_exactly_one_current"');
      }
    }

    await systemPrisma.branch.deleteMany({ where: { organizationId: otherOrganizationId } });
    await systemPrisma.organization.deleteMany({ where: { id: otherOrganizationId } });

    if (platformUserId) {
      await systemPrisma.tenantAccessAudit.deleteMany({ where: { userId: platformUserId } });
      await systemPrisma.user.deleteMany({ where: { id: platformUserId } });
    }

    await systemPrisma.saaSPlan.deleteMany({ where: { code: planCode } });
  }
});
