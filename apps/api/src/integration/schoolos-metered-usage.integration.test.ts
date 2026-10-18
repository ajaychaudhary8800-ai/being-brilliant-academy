import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { AppError } from "../lib/http.js";
import { systemPrisma } from "../lib/prisma.js";
import { consumeSchoolOSUsage } from "../lib/schoolos-usage-service.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
function assertIsolatedTestDb() {
  let u: URL | null = null;
  try { if (process.env.TEST_DATABASE_URL) u = new URL(process.env.TEST_DATABASE_URL); } catch { /* reject */ }
  if (!u || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL ||
    !["localhost", "127.0.0.1", "::1"].includes(u.hostname) ||
    !["postgres:", "postgresql:"].includes(u.protocol) ||
    !/(^|[_-])(test|integration)([_-]|$)/i.test(u.pathname.replace(/^\//, "")))
    throw new Error("Refusing metered usage test outside isolated local PostgreSQL TEST_DATABASE_URL");
}

test("PostgreSQL metering prevents concurrent overspend and replays idempotently", { skip: !enabled, timeout: 120_000 }, async () => {
  assertIsolatedTestDb();
  const organizationId = `schoolos-usage-${crypto.randomUUID().slice(0, 16)}`;
  const start = new Date("2026-10-01T00:00:00Z");
  const end = new Date("2026-11-01T00:00:00Z");
  const now = new Date("2026-10-18T12:00:00Z");
  try {
    await systemPrisma.organization.create({
      data: { id: organizationId, slug: organizationId,
        name: "Metering Integration Tenant", email: `${organizationId}@example.test` },
    });
    await systemPrisma.schoolOSUsageBalance.create({
      data: { organizationId, metric: "ai_credits", periodStart: start, periodEnd: end,
        grantedUnits: 10, consumedUnits: 0 },
    });
    const balanceBefore = await systemPrisma.schoolOSUsageBalance.findFirstOrThrow({ where: { organizationId, metric: "ai_credits" } });
    await assert.rejects(() => systemPrisma.schoolOSUsageEvent.create({
      data: { organizationId: "org_default", balanceId: balanceBefore.id, metric: "ai_credits",
        kind: "CONSUME", units: 1, requestKey: `foreign-tenant:${crypto.randomUUID()}` },
    }), "PostgreSQL must reject a usage debit belonging to another tenant");
    await assert.rejects(() => systemPrisma.schoolOSUsageEvent.create({
      data: { organizationId, balanceId: balanceBefore.id, metric: "video_minutes",
        kind: "CONSUME", units: 1, requestKey: `cross-metric:${crypto.randomUUID()}` },
    }), "PostgreSQL must reject a debit whose meter disagrees with the balance");
        const race = await Promise.allSettled([
      consumeSchoolOSUsage(organizationId, "ai_credits", 7, "exam-attempt:1", null, now),
      consumeSchoolOSUsage(organizationId, "ai_credits", 7, "exam-attempt:2", null, now),
    ]);
    assert.equal(race.filter(x => x.status === "fulfilled").length, 1);
    assert.equal(race.filter(x => x.status === "rejected").length, 1);
    const balance = await systemPrisma.schoolOSUsageBalance.findFirstOrThrow({ where: { organizationId, metric: "ai_credits" } });
    assert.equal(balance.consumedUnits, 7);
    assert.equal(balance.grantedUnits, 10);
    const charged = await systemPrisma.schoolOSUsageEvent.findFirstOrThrow({ where: { organizationId, kind: "CONSUME" } });
    assert.equal(await systemPrisma.schoolOSUsageEvent.count({ where: { organizationId } }), 1);

    const replay = await consumeSchoolOSUsage(organizationId, "ai_credits", 7, charged.requestKey, null, now);
    assert.equal(replay.charged, false);
    assert.equal(replay.remainingUnits, 3);
    await assert.rejects(
      () => consumeSchoolOSUsage(organizationId, "ai_credits", 2, charged.requestKey, null, now),
      error => error instanceof AppError,
    );
    await assert.rejects(
      () => consumeSchoolOSUsage(organizationId, "video_minutes", 1, "livekit-room:123", null, now),
      error => error instanceof AppError,
    );
    assert.equal(await systemPrisma.schoolOSUsageEvent.count({ where: { organizationId } }), 1);
  } finally {
    await systemPrisma.schoolOSUsageEvent.deleteMany({ where: { organizationId } });
    await systemPrisma.schoolOSUsageBalance.deleteMany({ where: { organizationId } });
    await systemPrisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" DISABLE TRIGGER "AcademicSession_exactly_one_current"');
      await tx.academicSession.deleteMany({ where: { organizationId } });
      await tx.organization.deleteMany({ where: { id: organizationId } });
      await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" ENABLE TRIGGER "AcademicSession_exactly_one_current"');
    });
  }
});
