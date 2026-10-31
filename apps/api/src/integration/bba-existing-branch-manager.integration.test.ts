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
    const ndg = await systemPrisma.branch.create({
      data: { organizationId, branchCode: "UAT-NDG", branchName: "Synthetic Nandgram", isActive: true },
    });
    const rne = await systemPrisma.branch.create({
      data: { organizationId, branchCode: "UAT-RNE", branchName: "Synthetic Rajnagar", isActive: true },
    });
    branchId = ndg.id; otherBranchId = rne.id;

    const app = express();
    app.use(express.json());
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
