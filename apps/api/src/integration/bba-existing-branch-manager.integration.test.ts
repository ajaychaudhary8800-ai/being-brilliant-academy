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
import adminCourses from "../routes/admin-courses.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
function assertSafeTarget() {
  const candidate = process.env.TEST_DATABASE_URL;
  if (!candidate || process.env.DATABASE_URL !== candidate) {
    throw new Error("BBA branch-manager integration test requires matching TEST_DATABASE_URL and DATABASE_URL");
  }
  const url = new URL(candidate);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    || !/(^|[_-])(test|integration)([_-]|$)/i.test(url.pathname.replace(/^\//, ""))) {
    throw new Error("Refusing BBA manager integration test outside a local integration database");
  }
}
async function call(port: number, path: string, jwtToken: string, body?: object) {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${jwtToken}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  return { status: r.status, payload: text ? JSON.parse(text) as any : null };
}

test("real PostgreSQL serializes competing existing-branch manager appointments and enforces assigned-branch scope", {
  skip: !enabled,
  timeout: 120_000,
}, async () => {
  assertSafeTarget();
  const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const organizationId = `bba-manager-integration-${nonce}`;
  const actorEmail = `bba-super-${nonce}@example.test`;
  const managerEmails = [
    `bba-ndg-manager-a-${nonce}@example.test`,
    `bba-ndg-manager-b-${nonce}@example.test`,
  ];
  let actorId: string | null = null;
  let branchId: string | null = null;
  let otherBranchId: string | null = null;
  let server: Server | null = null;
  try {
    await systemPrisma.organization.create({
      data: {
        id: organizationId, slug: organizationId,
        name: "Isolated BBA Manager Integration Fixture",
        email: `bba-manager-fixture-${nonce}@example.test`,
        subscriptionStatus: OrganizationSubscriptionStatus.ACTIVE,
        subscriptionEndsAt: new Date("2030-12-31T23:59:59Z"),
      },
    });
    const actor = await systemPrisma.user.create({
      data: {
        organizationId,
        email: actorEmail,
        name: "BBA Manager UAT Super Admin",
        role: Role.SUPER_ADMIN,
        passwordHash: "integration-only-invalid-login",
        emailVerifiedAt: new Date(),
      },
    });
    actorId = actor.id;
    // Synthetic tenant-wide invoice: a branch administrator must never see
    // its amount, because Invoice has no authoritative branch ownership.
    await systemPrisma.invoice.create({ data: {
      organizationId,
      invoiceNo: `BBA-PHASE4-SYNTHETIC-${nonce}`,
      userId: actor.id,
      amount: 12345,
      status: "PAID",
    } });
    const ndg = await systemPrisma.branch.create({
      data: { organizationId, branchCode: "UAT-NDG", branchName: "Synthetic Nandgram", isActive: true },
    });
    const rne = await systemPrisma.branch.create({
      data: { organizationId, branchCode: "UAT-RNE", branchName: "Synthetic Rajnagar", isActive: true },
    });
    branchId = ndg.id; otherBranchId = rne.id;
    const globalSlug = `schoolos-v5-global-${nonce}`;
    const localSlug = `schoolos-v5-ndg-${nonce}`;
    const foreignSlug = `schoolos-v5-rne-${nonce}`;
    await systemPrisma.course.createMany({ data: [
      { organizationId, title: "Synthetic Shared Catalogue", slug: globalSlug,
        courseCode: `G-${nonce}`, fullDescription: "Synthetic globally shared course for access checks",
        regularPricePaise: 0 },
      { organizationId, title: "Synthetic NDG Course", slug: localSlug,
        courseCode: `N-${nonce}`, fullDescription: "Synthetic NDG scoped course for access checks",
        regularPricePaise: 0, branchId: ndg.id },
      { organizationId, title: "Synthetic RNE Course", slug: foreignSlug,
        courseCode: `R-${nonce}`, fullDescription: "Synthetic RNE scoped course for access checks",
        regularPricePaise: 0, branchId: rne.id },
    ] });
    // A global course may have tenant-wide enrollments. The campus list
    // must never expose this aggregate to managers of other branches.
    const sharedCourse = await systemPrisma.course.findUniqueOrThrow({
      where: { slug: globalSlug }, select: { id: true },
    });
    await systemPrisma.enrollment.create({ data: {
      organizationId, courseId: sharedCourse.id, userId: actor.id,
    } });

    const app = express();
    app.use(express.json());
    app.use("/admin", adminCourses);
    app.use("/admin", admin);
    app.use(errorHandler);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server!.once("listening", resolve);
      server!.once("error", reject);
    });
    const port = (server.address() as AddressInfo).port;
    const token = (id: string, role: Role) => jwt.sign(
      { userId: id, role, organizationId },
      env.JWT_ACCESS_SECRET,
      { expiresIn: "5m" },
    );
    const superToken = token(actor.id, Role.SUPER_ADMIN);
    const appointment = (i: number) => call(port, `/admin/branches/${branchId}/manager`, superToken, {
      managerName: i === 0 ? "BBA Synthetic Manager A" : "BBA Synthetic Manager B",
      managerEmail: managerEmails[i],
    });

    // Concurrent competing SUPER_ADMIN attempts must commit only one
    // manager for the same branch, not two disjoint BranchUser links.
    const attempts = await Promise.all([appointment(0), appointment(1)]);
    const winners = attempts.map((result, index) => ({ result, index }))
      .filter(x => x.result.status === 201);
    const losers = attempts.map((result, index) => ({ result, index }))
      .filter(x => x.result.status === 409);
    assert.equal(winners.length, 1, JSON.stringify(attempts));
    assert.equal(losers.length, 1, JSON.stringify(attempts));
    assert.ok(["BRANCH_MANAGER_APPOINTMENT_CONFLICT", "BRANCH_MANAGER_ALREADY_ASSIGNED", "MANAGER_ACCOUNT_CONFLICT"]
      .includes(losers[0].result.payload?.error?.code), JSON.stringify(losers[0].result.payload));

    const winnerEmail = managerEmails[winners[0].index];
    const loserEmail = managerEmails[losers[0].index];
    const manager = await systemPrisma.user.findUniqueOrThrow({
      where: { email: winnerEmail },
      select: { id: true, organizationId: true, role: true, isActive: true },
    });
    assert.equal(manager.organizationId, organizationId);
    assert.equal(manager.role, Role.BRANCH_ADMIN);
    assert.equal(manager.isActive, true);
    assert.equal(await systemPrisma.user.count({
      where: { email: loserEmail },
    }), 0, "aborted attempt must not leave a stranded account");
    assert.equal(await systemPrisma.branchUser.count({
      where: { organizationId, branchId: ndg.id },
    }), 1);
    assert.equal(await systemPrisma.auditLog.count({
      where: { organizationId, entity: "Branch", entityId: ndg.id, action: "BRANCH_MANAGER_APPOINTED" },
    }), 1);

    // Replays must be read-safe and must not send a second setup email.
    const replay = await appointment(winners[0].index);
    assert.equal(replay.status, 200);
    assert.equal(replay.payload.data.managerAlreadyAssigned, true);
    assert.equal(await systemPrisma.branchUser.count({
      where: { organizationId, branchId: ndg.id },
    }), 1);

    // A real branch admin must be scoped to exactly the assigned branch,
    // while the authenticated tenant SUPER_ADMIN sees both branches.
    const branchToken = token(manager.id, Role.BRANCH_ADMIN);
    const scoped = await call(port, "/admin/branches?limit=20", branchToken);
    assert.equal(scoped.status, 200);
    assert.equal(scoped.payload.meta.total, 1);
    assert.equal(scoped.payload.data[0].id, ndg.id);

    const crossBranchRead = await call(port, `/admin/branches/${rne.id}`, branchToken);
    assert.equal(crossBranchRead.status, 403);
    const otherStudentScope = await call(port, `/admin/students?branchId=${rne.id}`, branchToken);
    assert.equal(otherStudentScope.status, 403);

    // The overview must honor the SAME assigned-branch boundary as branch
    // listings. Tenant-wide invoice revenue is restricted, not guessed.
    const branchOverview = await call(port, "/admin/overview", branchToken);
    assert.equal(branchOverview.status, 200, JSON.stringify(branchOverview.payload));
    assert.equal(branchOverview.payload.data.totalBranches, 1);
    assert.equal(branchOverview.payload.data.activeBranches, 1);
    assert.equal(branchOverview.payload.data.inactiveBranches, 0);
    assert.equal(branchOverview.payload.data.revenuePaise, null);
    assert.equal(branchOverview.payload.data.revenueScope, "WITHHELD_BRANCH");

    const unassigned = await systemPrisma.user.create({ data: {
      organizationId,
      email: `bba-unassigned-branch-admin-${nonce}@example.test`,
      name: "Synthetic Unassigned Branch Administrator",
      passwordHash: "integration-only-invalid-login",
      role: Role.BRANCH_ADMIN,
    } });
    const emptyOverview = await call(port, "/admin/overview", token(unassigned.id, Role.BRANCH_ADMIN));
    assert.equal(emptyOverview.status, 200, JSON.stringify(emptyOverview.payload));
    assert.equal(emptyOverview.payload.data.totalBranches, 0);
    assert.equal(emptyOverview.payload.data.students, 0);
    assert.equal(emptyOverview.payload.data.courses, 0);
    assert.equal(emptyOverview.payload.data.activeEnrollments, 0);
    assert.equal(emptyOverview.payload.data.revenuePaise, null);

    const campusCatalog = await call(port, "/admin/courses?limit=20", branchToken);
    assert.equal(campusCatalog.status, 200, JSON.stringify(campusCatalog.payload));
    assert.equal(campusCatalog.payload.meta.total, 2);
    assert.deepEqual(
      campusCatalog.payload.data.map((row: any) => row.slug).sort(),
      [globalSlug, localSlug].sort(),
    );
    const sharedForBranch = campusCatalog.payload.data.find((row: any) => row.slug === globalSlug);
    assert.equal(sharedForBranch._count.enrollments, 0,
      "another campus's shared-course enrollments must not be disclosed");
    const unassignedCatalog = await call(port, "/admin/courses?limit=20",
      token(unassigned.id, Role.BRANCH_ADMIN));
    assert.equal(unassignedCatalog.status, 200);
    assert.equal(unassignedCatalog.payload.meta.total, 0);
    assert.deepEqual(unassignedCatalog.payload.data, []);

    const fullCatalog = await call(port, "/admin/courses?limit=20", superToken);
    assert.equal(fullCatalog.status, 200, JSON.stringify(fullCatalog.payload));
    assert.equal(fullCatalog.payload.meta.total, 3);
    assert.equal(fullCatalog.payload.data.find((row: any) => row.slug === globalSlug)._count.enrollments, 1);

    const superOverview = await call(port, "/admin/overview", superToken);
    assert.equal(superOverview.status, 200, JSON.stringify(superOverview.payload));
    assert.equal(superOverview.payload.data.totalBranches, 2);
    assert.equal(superOverview.payload.data.revenuePaise, 12345);

    // A no-op role request must never bypass branch authorization. Build
    // lightweight synthetic role identities with explicit BranchUser scope.
    const roleTargets = await Promise.all(["ndg", "rne"].map(async campus => {
      const user = await systemPrisma.user.create({ data: {
        organizationId, email: `bba-role-${campus}-${nonce}@example.test`,
        name: `Synthetic ${campus} Teacher`, role: Role.TEACHER,
        passwordHash: "integration-only-invalid-login",
      } });
      await systemPrisma.branchUser.create({ data: {
        organizationId, branchId: campus === "ndg" ? ndg.id : rne.id, userId: user.id,
      } });
      return user;
    }));
    const unchangedRole = (id: string) => fetch(
      `http://127.0.0.1:${port}/admin/users/${id}/role`,
      { method: "PATCH", headers: {
        Authorization: `Bearer ${branchToken}`, "Content-Type": "application/json",
      }, body: JSON.stringify({ role: Role.TEACHER }) },
    );
    const ownRole = await unchangedRole(roleTargets[0].id);
    assert.equal(ownRole.status, 200, await ownRole.text());
    const foreignRole = await unchangedRole(roleTargets[1].id);
    assert.equal(foreignRole.status, 403);
    assert.equal((await foreignRole.json() as any).error.code, "USER_BRANCH_FORBIDDEN");
    const unchangedProtectedAdmin = await fetch(
      `http://127.0.0.1:${port}/admin/users/${manager.id}/role`,
      { method: "PATCH", headers: {
        Authorization: `Bearer ${branchToken}`, "Content-Type": "application/json",
      }, body: JSON.stringify({ role: Role.BRANCH_ADMIN }) },
    );
    assert.equal(unchangedProtectedAdmin.status, 403);
    // The target is the authenticated manager herself, so the stronger
    // self-role-change guard correctly takes precedence over grant checks.
    assert.equal((await unchangedProtectedAdmin.json() as any).error.code, "SELF_PRIVILEGE_CHANGE_FORBIDDEN");

    const fullScope = await call(port, "/admin/branches?limit=20", superToken);
    assert.equal(fullScope.status, 200);
    assert.equal(fullScope.payload.meta.total, 2);
    console.log("BBA_BRANCH_MANAGER_POSTGRES_CONCURRENT_AND_SCOPE=PASS");
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    // The test touches only a uniquely named tenant in TEST_DATABASE_URL.
    // Clear session setup tokens and audit records before dependent users.
    await systemPrisma.tenantAccessAudit.deleteMany({ where: { organizationId } });
    await systemPrisma.passwordResetToken.deleteMany({ where: { organizationId } });
    await systemPrisma.session.deleteMany({ where: { organizationId } });
    await systemPrisma.branchUser.deleteMany({ where: { organizationId } });
    await systemPrisma.auditLog.deleteMany({ where: { organizationId } });
    await systemPrisma.invoice.deleteMany({ where: { organizationId } });
    await systemPrisma.enrollment.deleteMany({ where: { organizationId } });
    await systemPrisma.course.deleteMany({ where: { organizationId } });
    if (branchId || otherBranchId) await systemPrisma.branch.deleteMany({ where: { organizationId } });
    if (actorId) await systemPrisma.user.deleteMany({ where: { organizationId } });
    const count = await systemPrisma.academicSession.count({ where: { organizationId } });
    if (count) {
      await systemPrisma.$transaction(async tx => {
        await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" DISABLE TRIGGER "AcademicSession_exactly_one_current"');
        try {
          await tx.academicSession.deleteMany({ where: { organizationId } });
          await tx.organization.deleteMany({ where: { id: organizationId } });
        } finally {
          await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" ENABLE TRIGGER "AcademicSession_exactly_one_current"');
        }
      });
    } else {
      await systemPrisma.organization.deleteMany({ where: { id: organizationId } });
    }
  }
});
