import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { FeePlanStatus, Prisma, Role } from "@prisma/client";
import { prisma, systemPrisma } from "../lib/prisma.js";
import { tenantContext } from "../lib/tenant-context.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
const barrier = (parties: number) => { let arrived = 0; let release!: () => void; const ready = new Promise<void>(resolve => { release = resolve; }); return () => { if (++arrived === parties) release(); return ready; }; };
const unique = (error: unknown, code: string) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
function assertSafeTarget() {
  const configured = process.env.TEST_DATABASE_URL;
  let parsed: URL | null = null;
  try { parsed = configured ? new URL(configured) : null; } catch { parsed = null; }
  const name = parsed?.pathname.replace(/^\//, "") ?? "";
  if (!configured || process.env.DATABASE_URL !== configured || !parsed || !["postgres:", "postgresql:"].includes(parsed.protocol) || !new Set(["localhost", "127.0.0.1", "::1"]).has(parsed.hostname) || !/(^|[_-])(test|integration)([_-]|$)/i.test(name)) throw new Error("Refusing fee-plan integration test outside a local TEST_DATABASE_URL");
}

test("real PostgreSQL fee-plan version and active-applicability races remain safe", { skip: !enabled, timeout: 60_000 }, async () => {
  assertSafeTarget();
  const organizationId = `phase1-fee-plan-${crypto.randomUUID()}`;
  const otherOrganizationId = `phase1-fee-plan-other-${crypto.randomUUID()}`;
  let sessionId: string | undefined;
  let userId: string | undefined;
  let otherOrganizationCreated = false;
  let otherUserId: string | undefined;
  const planIds: string[] = [];
  try {
    await systemPrisma.organization.create({ data: { id: organizationId, slug: organizationId, name: organizationId, email: `${organizationId}@example.test` } });
    const sessions = await systemPrisma.academicSession.findMany({ where: { organizationId }, select: { id: true, name: true, startsAt: true, endsAt: true, isCurrent: true } });
    assert.equal(sessions.length, 1, `Expected exactly one bootstrapped AcademicSession for ${organizationId}; found ${sessions.length}`);
    const currentSessions = sessions.filter(item => item.isCurrent);
    assert.equal(currentSessions.length, 1, `Expected exactly one current bootstrapped AcademicSession for ${organizationId}; found ${currentSessions.length}`);
    const session = currentSessions[0]!;
    sessionId = session.id;
    assert.ok(session.startsAt < session.endsAt);
    const user = await systemPrisma.user.create({ data: { organizationId, email: `${organizationId}@example.test`, passwordHash: "integration", name: "Fee Plan Integration", role: Role.SUPER_ADMIN } });
    userId = user.id;
    const familyKey = `family-${crypto.randomUUID()}`;
    const base = await systemPrisma.feePlan.create({ data: { organizationId, familyKey, code: "PG-PLAN", name: `PG Plan ${session.name}`, version: 1, status: FeePlanStatus.ACTIVE, academicSessionId: session.id, createdById: user.id } });
    planIds.push(base.id);
    const withinTenant = <T>(work: () => Promise<T>) => tenantContext.run({ organizationId, userId: user.id, role: Role.SUPER_ADMIN }, work);

    const waitAfterLatestRead = barrier(2);
    const createNext = () => withinTenant(() => prisma.$transaction(async tx => {
      const latest = await tx.feePlan.findFirst({ where: { organizationId, familyKey }, orderBy: { version: "desc" }, select: { version: true } });
      await waitAfterLatestRead();
      const plan = await tx.feePlan.create({ data: { organizationId, familyKey, code: "PG-PLAN", name: "PG Plan", version: (latest?.version ?? 0) + 1, status: FeePlanStatus.DRAFT, academicSessionId: session!.id, createdById: user!.id } });
      planIds.push(plan.id);
      return plan;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    const versionResults = await Promise.allSettled([createNext(), createNext()]);
    const successfulVersions = versionResults.filter((result): result is PromiseFulfilledResult<any> => result.status === "fulfilled");
    assert.equal(successfulVersions.length, 1);
    assert.equal(versionResults.filter(result => result.status === "rejected").length, 1);
    assert.ok(versionResults.some(result => result.status === "rejected" && (unique(result.reason, "P2002") || unique(result.reason, "P2034"))));
    const version2 = successfulVersions[0]!.value;
    assert.equal(version2.version, 2);
    assert.equal(await systemPrisma.feePlan.count({ where: { organizationId, familyKey, version: 2 } }), 1);

    const version3 = await systemPrisma.feePlan.create({ data: { organizationId, familyKey, code: "PG-PLAN", name: `PG Plan ${session.name}`, version: 3, status: FeePlanStatus.DRAFT, academicSessionId: session.id, createdById: user.id } });
    planIds.push(version3.id);
    assert.equal(version3.version, 3);
    const activationCandidates = [version2, version3];
    const beforeActivation = await systemPrisma.feePlan.findMany({ where: { id: { in: activationCandidates.map(item => item.id) }, organizationId }, select: { id: true, version: true, status: true } });
    assert.equal(beforeActivation.length, 2);
    assert.ok(beforeActivation.every(item => item.status === FeePlanStatus.DRAFT));
    const waitForActivation = barrier(2);
    const activate = (id: string) => waitForActivation().then(() => withinTenant(() => prisma.$transaction(async tx => {
      await tx.feePlan.updateMany({ where: { organizationId, familyKey, academicSessionId: session!.id, branchId: null, courseId: null, batchId: null, status: FeePlanStatus.ACTIVE, id: { not: id } }, data: { status: FeePlanStatus.INACTIVE } });
      await tx.feePlan.update({ where: { id }, data: { status: FeePlanStatus.ACTIVE } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })));
    const activationResults = await Promise.allSettled(activationCandidates.map(item => activate(item.id)));
    const activationFailures = activationResults.filter(result => result.status === "rejected");
    assert.equal(activationResults.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(activationFailures.length, 1);
    assert.ok(activationFailures.every(result => unique(result.reason, "P2002") || unique(result.reason, "P2034")));
    const activePlans = await systemPrisma.feePlan.findMany({ where: { organizationId, familyKey, academicSessionId: session.id, branchId: null, courseId: null, batchId: null, status: FeePlanStatus.ACTIVE }, select: { id: true, version: true, status: true } });
    assert.equal(activePlans.length, 1);
    assert.ok(activationCandidates.some(item => item.id === activePlans[0]!.id));

    const nullableFamily = `null-scope-${crypto.randomUUID()}`;
    const createNullable = (version: number) => systemPrisma.feePlan.create({ data: { organizationId, familyKey: nullableFamily, code: "NULL-SCOPE", name: "Null Scope", version, status: FeePlanStatus.ACTIVE, academicSessionId: session.id, createdById: user.id } });
    await createNullable(1).then(plan => planIds.push(plan.id));
    await assert.rejects(createNullable(2), error => unique(error, "P2002"));

    await systemPrisma.organization.create({ data: { id: otherOrganizationId, slug: otherOrganizationId, name: otherOrganizationId, email: `${otherOrganizationId}@example.test` } });
    otherOrganizationCreated = true;
    const otherSessions = await systemPrisma.academicSession.findMany({ where: { organizationId: otherOrganizationId }, select: { id: true, startsAt: true, isCurrent: true } });
    assert.equal(otherSessions.filter(item => item.isCurrent).length, 1);
    const otherSession = otherSessions.find(item => item.isCurrent)!;
    const otherUser = await systemPrisma.user.create({ data: { organizationId: otherOrganizationId, email: `${otherOrganizationId}@example.test`, passwordHash: "integration", name: "Other Fee Plan Integration", role: Role.SUPER_ADMIN } });
    otherUserId = otherUser.id;
    const otherPlan = await systemPrisma.feePlan.create({ data: { organizationId: otherOrganizationId, familyKey: `lineage-${crypto.randomUUID()}`, code: "OTHER-PLAN", name: "Other Plan", version: 1, status: FeePlanStatus.DRAFT, academicSessionId: otherSession.id, createdById: otherUser.id } });
    await assert.rejects(systemPrisma.feePlan.update({ where: { id: otherPlan.id }, data: { supersedesId: base.id } }), error => unique(error, "P2003"));
    const sourceInstallment = await systemPrisma.feePlanInstallment.create({ data: { organizationId, planId: base.id, sequence: 1, title: "Source installment", dueDate: session.startsAt } });
    await assert.rejects(systemPrisma.feePlanInstallment.create({ data: { organizationId: otherOrganizationId, planId: base.id, sequence: 2, title: "Cross-tenant installment", dueDate: session.startsAt } }), error => unique(error, "P2003"));
    await assert.rejects(systemPrisma.feePlanComponent.create({ data: { organizationId: otherOrganizationId, installmentId: sourceInstallment.id, feeHead: "Transport", normalizedFeeHead: "transport", amountPaise: 1_000 } }), error => unique(error, "P2003"));
  } finally {
    assertSafeTarget();
    if (organizationId || otherOrganizationCreated) await systemPrisma.$transaction(async tx => {
      await tx.feePlanComponent.deleteMany({ where: { organizationId } });
      await tx.feePlanInstallment.deleteMany({ where: { organizationId } });
      await tx.feePlan.deleteMany({ where: { organizationId } });
      if (userId) await tx.user.deleteMany({ where: { organizationId, id: userId } });
      await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" DISABLE TRIGGER "AcademicSession_exactly_one_current"');
      const sessionDelete = await tx.academicSession.deleteMany({ where: { organizationId } });
      const remainingSessions = await tx.academicSession.count({ where: { organizationId } });
      if (remainingSessions !== 0) throw new Error(`AcademicSession fixture rows remain (${remainingSessions}) for organization ${organizationId}`);
      const organizationDelete = await tx.organization.deleteMany({ where: { id: organizationId } });
      if (organizationDelete.count !== 1) throw new Error(`Expected to delete exactly one Organization ${organizationId}; deleted ${organizationDelete.count}; sessions deleted ${sessionDelete.count}`);
      if (otherOrganizationCreated) {
        await tx.feePlanComponent.deleteMany({ where: { organizationId: otherOrganizationId } });
        await tx.feePlanInstallment.deleteMany({ where: { organizationId: otherOrganizationId } });
        await tx.feePlan.deleteMany({ where: { organizationId: otherOrganizationId } });
        if (otherUserId) await tx.user.deleteMany({ where: { organizationId: otherOrganizationId, id: otherUserId } });
        await tx.academicSession.deleteMany({ where: { organizationId: otherOrganizationId } });
        const otherOrganizationDelete = await tx.organization.deleteMany({ where: { id: otherOrganizationId } });
        if (otherOrganizationDelete.count !== 1) throw new Error(`Expected to delete exactly one Organization ${otherOrganizationId}; deleted ${otherOrganizationDelete.count}`);
      }
      await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" ENABLE TRIGGER "AcademicSession_exactly_one_current"');
    });
  }
});
