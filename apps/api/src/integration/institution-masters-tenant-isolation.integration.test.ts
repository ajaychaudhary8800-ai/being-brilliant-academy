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
import academicSessions from "../routes/admin-academic-sessions.js";
import educationMasters from "../routes/admin-education-masters.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";

function assertSafeDatabase() {
  const candidate = process.env.TEST_DATABASE_URL;
  if (!candidate || candidate !== process.env.DATABASE_URL)
    throw new Error("Institution-isolation acceptance requires exactly matching test database variables");
  const url = new URL(candidate);
  if (!["postgresql:", "postgres:"].includes(url.protocol)
    || !["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    || !/(^|[_-])(test|integration)([_-]|$)/i.test(url.pathname.replace(/^\//, "")))
    throw new Error("Institution-isolation acceptance refuses non-local or non-integration database");
}

async function http(port: number, path: string, token: string, method = "GET", body?: object) {
  const response = await fetch(`http://127.0.0.1:${port}/admin${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await response.text();
  return { status: response.status, data: raw ? JSON.parse(raw) as any : null };
}

test("real PostgreSQL: academic sessions and education masters remain institution-bound across HTTP reads, changes, and current resets", {
  skip: !enabled,
  timeout: 120_000,
}, async () => {
  assertSafeDatabase();
  const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const orgA = `v5-institution-a-${nonce}`;
  const orgB = `v5-institution-b-${nonce}`;
  const organizations = [orgA, orgB];
  let server: Server | undefined;
  try {
    for (const [index, organizationId] of organizations.entries()) {
      await systemPrisma.organization.create({ data: {
        id: organizationId, slug: organizationId,
        name: `Synthetic Institution ${index + 1}`,
        email: `v5-inst-${index}-${nonce}@example.test`,
        subscriptionStatus: OrganizationSubscriptionStatus.ACTIVE,
        subscriptionEndsAt: new Date("2030-12-31T23:59:59Z"),
      } });
    }
    const [userA, userB] = await Promise.all(organizations.map((organizationId, index) =>
      systemPrisma.user.create({ data: {
        organizationId, email: `v5-inst-admin-${index}-${nonce}@example.test`,
        name: "Synthetic Institution Super Admin", role: Role.SUPER_ADMIN,
        passwordHash: "integration-only-invalid-login", emailVerifiedAt: new Date(),
      } }),
    ));

    const makeSession = (organizationId: string, name: string, isCurrent: boolean) =>
      systemPrisma.academicSession.create({ data: {
        organizationId, name, isCurrent,
        startsAt: new Date(name.startsWith("2026") ? "2026-04-01" : "2027-04-01"),
        endsAt: new Date(name.startsWith("2026") ? "2027-03-31" : "2028-03-31"),
      } });
    // Tenant bootstrap migrations may already provision the first/current
    // academic session. Reuse it instead of inserting a duplicate name.
    const [existingA, existingB] = await Promise.all([
      systemPrisma.academicSession.findFirst({
        where: { organizationId: orgA, isCurrent: true },
      }),
      systemPrisma.academicSession.findFirst({
        where: { organizationId: orgB, isCurrent: true },
      }),
    ]);
    const sessionA = existingA ?? await makeSession(orgA, `2026-27-${nonce}`, true);
    const sessionB = existingB ?? await makeSession(orgB, `2026-27-${nonce}`, true);
    const initialNameB = sessionB.name;
    const nextA = await makeSession(orgA, `UAT-2027-${nonce}`, false);
    const localSessionCount = await systemPrisma.academicSession.count({
      where: { organizationId: orgA },
    });

    // Foreign-organization metadata is created directly with the system test
    // client. The API requests themselves must never read or mutate those rows.
    const [foreignExam, foreignSkill, foreignSpecialization] = await Promise.all([
      systemPrisma.competitiveExam.create({ data: {
        organizationId: orgB, name: "Other Institution Exam", code: `FOREIGN_EXAM_${nonce}`,
      } }),
      systemPrisma.skillCategory.create({ data: {
        organizationId: orgB, name: "Other Institution Skill", code: `FOREIGN_SKILL_${nonce}`,
      } }),
      systemPrisma.specialization.create({ data: {
        organizationId: orgB, name: "Other Institution Specialization", code: `FOREIGN_SPEC_${nonce}`,
      } }),
    ]);

    const app = express();
    app.use(express.json());
    app.use("/admin", academicSessions);
    app.use("/admin", educationMasters);
    app.use(errorHandler);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server!.once("listening", resolve);
      server!.once("error", reject);
    });
    const port = (server.address() as AddressInfo).port;
    const token = (id: string, organizationId: string) =>
      jwt.sign({ userId: id, role: Role.SUPER_ADMIN, organizationId },
        env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
    const a = token(userA.id, orgA);
    const b = token(userB.id, orgB);

    const listA = await http(port, "/academic-sessions?limit=30", a);
    assert.equal(listA.status, 200, JSON.stringify(listA.data));
    assert.equal(listA.data.meta.total, localSessionCount);
    assert.ok(listA.data.data.every((s: any) => s.organizationId === orgA));
    const ownCurrent = await http(port, "/academic-sessions/current", a);
    const foreignCurrent = await http(port, "/academic-sessions/current", b);
    assert.equal(ownCurrent.data.data.id, sessionA.id);
    assert.equal(foreignCurrent.data.data.id, sessionB.id);

    const forbiddenDetail = await http(port, `/academic-sessions/${sessionB.id}`, a);
    assert.equal(forbiddenDetail.status, 404);
    const forbiddenEdit = await http(port, `/academic-sessions/${sessionB.id}`, a,
      "PATCH", { name: "Illegally renamed by A" });
    assert.equal(forbiddenEdit.status, 404);
    const forbiddenCurrent = await http(port, `/academic-sessions/${sessionB.id}/current`, a, "PATCH", {});
    assert.equal(forbiddenCurrent.status, 404);
    const selectA = await http(port, `/academic-sessions/${nextA.id}/current`, a, "PATCH", {});
    assert.equal(selectA.status, 200, JSON.stringify(selectA.data));
    assert.equal((await http(port, "/academic-sessions/current", a)).data.data.id, nextA.id);
    assert.equal((await http(port, "/academic-sessions/current", b)).data.data.id, sessionB.id,
      "A changing its current session must never clear B's current session");
    assert.equal((await systemPrisma.academicSession.findUniqueOrThrow({
      where: { id: sessionB.id },
    })).name, initialNameB);

    const mastersA = await http(port, "/education-masters?includeInactive=true", a);
    assert.equal(mastersA.status, 200, JSON.stringify(mastersA.data));
    for (const kind of ["competitiveExams", "skillCategories", "specializations"]) {
      assert.ok(mastersA.data.data[kind].length > 0);
      assert.ok(mastersA.data.data[kind].every((v: any) => v.organizationId === orgA),
        `A cannot list another institution's ${kind}`);
    }

    const tests = [
      [`/education-masters/competitive-exams/${foreignExam.id}`, { name: "Illegal exam edit" }],
      [`/education-masters/skill-categories/${foreignSkill.id}`, { name: "Illegal skill edit" }],
      [`/education-masters/specializations/${foreignSpecialization.id}`, { name: "Illegal specialization edit" }],
    ] as const;
    for (const [path, body] of tests) {
      const denied = await http(port, path, a, "PATCH", body);
      assert.equal(denied.status, 404, `${path}: ${JSON.stringify(denied.data)}`);
    }
    const foreignParent = await http(port, "/education-masters/skill-categories", a, "POST", {
      name: "Cross-tenant child should fail", code: `NO_PARENT_${nonce}`,
      parentId: foreignSkill.id,
    });
    assert.equal(foreignParent.status, 422, JSON.stringify(foreignParent.data));
    const [examAfter, skillAfter, specializationAfter] = await Promise.all([
      systemPrisma.competitiveExam.findUniqueOrThrow({ where: { id: foreignExam.id } }),
      systemPrisma.skillCategory.findUniqueOrThrow({ where: { id: foreignSkill.id } }),
      systemPrisma.specialization.findUniqueOrThrow({ where: { id: foreignSpecialization.id } }),
    ]);
    assert.equal(examAfter.name, "Other Institution Exam");
    assert.equal(skillAfter.name, "Other Institution Skill");
    assert.equal(specializationAfter.name, "Other Institution Specialization");
    console.log("V5_INSTITUTION_MASTER_POSTGRES_TENANT_BOUNDARIES=PASS");
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    const where = { organizationId: { in: organizations } };
    // Only synthetic tenant IDs; run against disposable local *_test DB.
    await systemPrisma.tenantAccessAudit.deleteMany({ where });
    await systemPrisma.auditLog.deleteMany({ where });
    await systemPrisma.subject.deleteMany({ where });
    await systemPrisma.competitiveExam.deleteMany({ where });
    await systemPrisma.specialization.deleteMany({ where });
    await systemPrisma.skillCategory.deleteMany({ where });
    await systemPrisma.user.deleteMany({ where });
    await systemPrisma.$transaction(async tx => {
      // The deferred one-current-session trigger rejects deleting a test
      // tenant's final current session. Disable only transactionally, for the
      // duration of explicit isolated synthetic cleanup.
      await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" DISABLE TRIGGER "AcademicSession_exactly_one_current"');
      try {
        await tx.academicSession.deleteMany({ where });
        await tx.organization.deleteMany({ where: { id: { in: organizations } } });
      } finally {
        await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" ENABLE TRIGGER "AcademicSession_exactly_one_current"');
      }
    });
  }
});
