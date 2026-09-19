import "express-async-errors";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Prisma, Role } from "@prisma/client";
import express from "express";
import jwt from "jsonwebtoken";
import { env } from "../config.js";
import { errorHandler } from "../lib/http.js";
import { systemPrisma } from "../lib/prisma.js";
import communication from "../routes/communication.js";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
const fixtureId = crypto.randomUUID();
const orgIds = [`communication-${fixtureId}-a`, `communication-${fixtureId}-b`];
const cuid = () => `c${crypto.randomUUID().replaceAll("-", "")}`;
const isForeignKey = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
const isUnique = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
const migrationSql = readFileSync(new URL("../../prisma/migrations/20260919140000_harden_communication_tenant_integrity/migration.sql", import.meta.url), "utf8");
const reconcileFunction = migrationSql.match(/CREATE FUNCTION pg_temp\.reconcile_communication_tenant\([\s\S]*?\$\$;/)?.[0]
  .replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION");

function assertDedicatedDatabase() {
  const value = process.env.TEST_DATABASE_URL;
  const url = value ? new URL(value) : null;
  if (!enabled || !url || process.env.DATABASE_URL !== value || !["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    || !/(^|[_-])integration([_-]|$)/i.test(url.pathname)) {
    throw new Error("Communication tenant integration tests require the opted-in local integration database");
  }
}

async function cleanup(organizationId: string) {
  if (!await systemPrisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } })) return;
  await systemPrisma.portalMessage.deleteMany({ where: { organizationId } });
  await systemPrisma.messageThread.deleteMany({ where: { organizationId } });
  await systemPrisma.notification.deleteMany({ where: { organizationId } });
  await systemPrisma.announcement.deleteMany({ where: { organizationId } });
  await systemPrisma.circular.deleteMany({ where: { organizationId } });
  await systemPrisma.calendarEvent.deleteMany({ where: { organizationId } });
  await systemPrisma.notificationPreference.deleteMany({ where: { organizationId } });
  await systemPrisma.auditLog.deleteMany({ where: { organizationId } });
  await systemPrisma.tenantAccessAudit.deleteMany({ where: { organizationId } });
  await systemPrisma.batch.deleteMany({ where: { organizationId } });
  await systemPrisma.branch.deleteMany({ where: { organizationId } });
  await systemPrisma.user.deleteMany({ where: { organizationId } });
  assertDedicatedDatabase();
  await systemPrisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" DISABLE TRIGGER "AcademicSession_exactly_one_current"');
    await tx.academicSession.deleteMany({ where: { organizationId } });
    await tx.organization.delete({ where: { id: organizationId } });
    await tx.$executeRawUnsafe('ALTER TABLE "AcademicSession" ENABLE TRIGGER "AcademicSession_exactly_one_current"');
  });
}

test("3A2 migration preflight backfills only default tenant contamination and fails on corruption", { skip: !enabled }, async t => {
  assertDedicatedDatabase();
  assert.ok(reconcileFunction, "Migration reconciliation function must exist");
  const setup = async (tx: Prisma.TransactionClient) => {
    await tx.$executeRawUnsafe('CREATE TEMP TABLE "_communication_tenant_targets" (row_tid tid NOT NULL, parent_organization_id text NOT NULL) ON COMMIT DROP');
    await tx.$executeRawUnsafe('CREATE TEMP TABLE "User" ("id" text PRIMARY KEY, "organizationId" text NOT NULL) ON COMMIT DROP');
    await tx.$executeRawUnsafe('CREATE TEMP TABLE "Notification" ("id" text PRIMARY KEY, "organizationId" text NOT NULL, "userId" text NOT NULL) ON COMMIT DROP');
    await tx.$executeRawUnsafe(reconcileFunction!);
    await tx.$executeRawUnsafe('INSERT INTO "User" ("id", "organizationId") VALUES ($1, $2)', "preflight-user", orgIds[0]);
  };
  const reconcile = (tx: Prisma.TransactionClient) => tx.$executeRawUnsafe('DO $$ BEGIN PERFORM pg_temp.reconcile_communication_tenant(\'Notification\', \'[["User","userId"]]\'::jsonb); END $$;');

  await t.test("unambiguous org_default row is backfilled from its parent", async () => {
    await systemPrisma.$transaction(async tx => {
      await setup(tx);
      await tx.$executeRawUnsafe('INSERT INTO "Notification" ("id", "organizationId", "userId") VALUES ($1, $2, $3)', "preflight-notification", "org_default", "preflight-user");
      await reconcile(tx);
      const rows = await tx.$queryRawUnsafe<Array<{ organizationId: string }>>('SELECT "organizationId" FROM "Notification" WHERE "id" = $1', "preflight-notification");
      assert.equal(rows[0]?.organizationId, orgIds[0]);
    });
  });
  await t.test("non-default mismatched child tenant aborts migration preflight", async () => {
    await assert.rejects(systemPrisma.$transaction(async tx => {
      await setup(tx);
      await tx.$executeRawUnsafe('INSERT INTO "Notification" ("id", "organizationId", "userId") VALUES ($1, $2, $3)', "preflight-notification", orgIds[1], "preflight-user");
      await reconcile(tx);
    }), /non-default organizationId/);
  });
  await t.test("a missing parent aborts migration preflight", async () => {
    await assert.rejects(systemPrisma.$transaction(async tx => {
      await setup(tx);
      await tx.$executeRawUnsafe('INSERT INTO "Notification" ("id", "organizationId", "userId") VALUES ($1, $2, $3)', "preflight-notification", "org_default", "absent-user");
      await reconcile(tx);
    }), /missing parent/);
  });
  await t.test("parents from different organizations abort before default backfill", async () => {
    await assert.rejects(systemPrisma.$transaction(async tx => {
      await setup(tx);
      await tx.$executeRawUnsafe('CREATE TEMP TABLE "Branch" ("id" text PRIMARY KEY, "organizationId" text NOT NULL) ON COMMIT DROP');
      await tx.$executeRawUnsafe('CREATE TEMP TABLE "Announcement" ("id" text PRIMARY KEY, "organizationId" text NOT NULL, "authorId" text NOT NULL, "branchId" text) ON COMMIT DROP');
      await tx.$executeRawUnsafe('INSERT INTO "Branch" ("id", "organizationId") VALUES ($1, $2)', "preflight-branch", orgIds[1]);
      await tx.$executeRawUnsafe('INSERT INTO "Announcement" ("id", "organizationId", "authorId", "branchId") VALUES ($1, $2, $3, $4)', "preflight-announcement", "org_default", "preflight-user", "preflight-branch");
      await tx.$executeRawUnsafe('DO $$ BEGIN PERFORM pg_temp.reconcile_communication_tenant(\'Announcement\', \'[["User","authorId"],["Branch","branchId"]]\'::jsonb); END $$;');
    }), /parents belong to different organizations/);
  });
});

test("communication rows and foreign keys enforce organization integrity in PostgreSQL", { skip: !enabled, timeout: 120_000 }, async t => {
  assertDedicatedDatabase();
  const [a, b] = orgIds;
  const serverApp = express();
  serverApp.use(express.json());
  serverApp.use("/api/v1", communication);
  serverApp.use(errorHandler);
  let server: ReturnType<typeof serverApp.listen> | undefined;
  try {
    const organizations = await Promise.all([a, b].map(async organizationId => systemPrisma.organization.create({
      data: { id: organizationId, slug: organizationId, name: organizationId, email: `${organizationId}@example.test`, subscriptionStatus: "ACTIVE" },
    })));
    assert.equal(organizations.length, 2);
    const branches = await Promise.all([a, b].map(organizationId => systemPrisma.branch.create({
      data: { id: cuid(), organizationId, branchCode: `branch-${organizationId}`, branchName: "Integration branch" },
    })));
    const sessions = await Promise.all([a, b].map(organizationId => systemPrisma.academicSession.findFirstOrThrow({ where: { organizationId, isCurrent: true } })));
    const batches = await Promise.all([a, b].map((organizationId, index) => systemPrisma.batch.create({
      data: { id: cuid(), organizationId, name: "Integration batch", code: `batch-${organizationId}`, branchId: branches[index]!.id, academicSessionId: sessions[index]!.id, startsAt: new Date("2026-04-01") },
    })));
    const [adminA, memberA, userB] = await Promise.all([
      [a, "admin"], [a, "member"], [b, "user"],
    ].map(([organizationId, label]) => systemPrisma.user.create({ data: {
      id: cuid(), organizationId: organizationId!, email: `${label}-${organizationId}@example.test`, name: label!, passwordHash: "integration", role: Role.SUPER_ADMIN,
    } })));

    server = serverApp.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => { server!.once("listening", resolve); server!.once("error", reject); });
    const port = (server.address() as AddressInfo).port;
    const token = jwt.sign({ userId: adminA!.id, role: Role.SUPER_ADMIN, organizationId: a }, env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
    const post = async (path: string, body: object) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as any;
      assert.equal(response.status, 201, `${path}: ${JSON.stringify(payload)}`);
      return payload.data;
    };

    const circularNumber = `CIRC-${fixtureId}`;
    const [notifications, thread, circular] = await Promise.all([
      post("/communication/notifications", { userIds: [memberA!.id], title: "Tenant notice", body: "Message", category: "GENERAL", channels: ["IN_APP", "EMAIL"] }),
      post("/communication/threads", { name: "Tenant thread", memberIds: [memberA!.id] }),
      post("/communication/circulars", { number: circularNumber, title: "Tenant circular", branchId: branches[0]!.id, body: "Version one" }),
    ]);
    const notification = await systemPrisma.notification.findUniqueOrThrow({ where: { id: notifications[0].id }, include: { deliveries: true } });
    const savedThread = await systemPrisma.messageThread.findUniqueOrThrow({ where: { id: thread.id }, include: { members: true } });
    const savedCircular = await systemPrisma.circular.findUniqueOrThrow({ where: { id: circular.id }, include: { versions: true } });

    await t.test("non-default route creates persist tenant on notification and delivery, thread and members, circular and version", () => {
      assert.equal(notification.organizationId, a);
      assert.equal(notification.deliveries.length, 1);
      assert.ok(notification.deliveries.every(row => row.organizationId === a));
      assert.equal(savedThread.organizationId, a);
      assert.equal(savedThread.members.length, 2);
      assert.ok(savedThread.members.every(row => row.organizationId === a));
      assert.equal(savedCircular.organizationId, a);
      assert.equal(savedCircular.versions.length, 1);
      assert.ok(savedCircular.versions.every(row => row.organizationId === a));
    });

    const otherCircular = await systemPrisma.circular.create({ data: { organizationId: b, number: circularNumber, title: "Other tenant circular", branchId: branches[1]!.id } });
    await t.test("circular number is unique within, not across, organizations", async () => {
      assert.equal(otherCircular.organizationId, b);
      await assert.rejects(systemPrisma.circular.create({ data: { organizationId: a, number: circularNumber, title: "Duplicate" } }), isUnique);
    });

    const announcement = await systemPrisma.announcement.create({ data: { organizationId: a, title: "Tenant announcement", body: "Body", authorId: adminA!.id, branchId: branches[0]!.id, batchId: batches[0]!.id } });
    const event = await systemPrisma.calendarEvent.create({ data: { organizationId: a, title: "Tenant event", type: "MEETING", startsAt: new Date("2027-01-01"), endsAt: new Date("2027-01-02"), branchId: branches[0]!.id, batchId: batches[0]!.id } });
    const rejected: Array<[string, () => Promise<unknown>]> = [
      ["delivery to another tenant notification", () => systemPrisma.notificationDelivery.create({ data: { organizationId: b, notificationId: notification.id, channel: "SMS" } })],
      ["announcement read for another tenant announcement", () => systemPrisma.announcementRead.create({ data: { organizationId: b, announcementId: announcement.id, userId: userB!.id } })],
      ["member of another tenant thread", () => systemPrisma.messageThreadMember.create({ data: { organizationId: b, threadId: thread.id, userId: userB!.id } })],
      ["version of another tenant circular", () => systemPrisma.circularVersion.create({ data: { organizationId: b, circularId: circular.id, version: 2, body: "No" } })],
      ["acknowledgement of another tenant circular", () => systemPrisma.circularAcknowledgement.create({ data: { organizationId: b, circularId: circular.id, userId: userB!.id } })],
      ["download of another tenant circular", () => systemPrisma.circularDownload.create({ data: { organizationId: b, circularId: circular.id, userId: userB!.id } })],
      ["RSVP to another tenant event", () => systemPrisma.calendarEventRsvp.create({ data: { organizationId: b, eventId: event.id, userId: userB!.id, response: "YES" } })],
      ["notification to another tenant user", () => systemPrisma.notification.create({ data: { organizationId: a, userId: userB!.id, title: "No", body: "No" } })],
      ["preference for another tenant user", () => systemPrisma.notificationPreference.create({ data: { organizationId: a, userId: userB!.id } })],
      ["announcement by another tenant author", () => systemPrisma.announcement.create({ data: { organizationId: a, authorId: userB!.id, title: "No", body: "No" } })],
      ["thread by another tenant creator", () => systemPrisma.messageThread.create({ data: { organizationId: a, createdById: userB!.id } })],
      ["portal message to another tenant recipient", () => systemPrisma.portalMessage.create({ data: { organizationId: a, senderId: adminA!.id, recipientId: userB!.id, subject: "No", body: "No" } })],
      ["announcement at another tenant branch", () => systemPrisma.announcement.create({ data: { organizationId: a, authorId: adminA!.id, branchId: branches[1]!.id, title: "No", body: "No" } })],
      ["announcement at another tenant batch", () => systemPrisma.announcement.create({ data: { organizationId: a, authorId: adminA!.id, batchId: batches[1]!.id, title: "No", body: "No" } })],
      ["circular at another tenant branch", () => systemPrisma.circular.create({ data: { organizationId: a, branchId: branches[1]!.id, number: `wrong-${fixtureId}`, title: "No" } })],
      ["event at another tenant branch", () => systemPrisma.calendarEvent.create({ data: { organizationId: a, branchId: branches[1]!.id, title: "No", type: "MEETING", startsAt: new Date("2027-01-01"), endsAt: new Date("2027-01-02") } })],
      ["event at another tenant batch", () => systemPrisma.calendarEvent.create({ data: { organizationId: a, batchId: batches[1]!.id, title: "No", type: "MEETING", startsAt: new Date("2027-01-01"), endsAt: new Date("2027-01-02") } })],
    ];
    for (const [label, operation] of rejected) await t.test(`database rejects ${label}`, async () => { await assert.rejects(operation(), isForeignKey); });

    await t.test("deleting an Announcement branch clears only branchId", async () => {
      const organizationId = `communication-set-null-${crypto.randomUUID()}`;
      try {
        await systemPrisma.organization.create({ data: { id: organizationId, slug: organizationId, name: organizationId, email: `${organizationId}@example.test`, subscriptionStatus: "ACTIVE" } });
        const author = await systemPrisma.user.create({ data: { id: cuid(), organizationId, email: `author-${organizationId}@example.test`, name: "Announcement author", passwordHash: "integration", role: Role.SUPER_ADMIN } });
        const branch = await systemPrisma.branch.create({ data: { id: cuid(), organizationId, branchCode: `branch-${organizationId}`, branchName: "Disposable announcement branch" } });
        const announcement = await systemPrisma.announcement.create({ data: { organizationId, authorId: author.id, branchId: branch.id, title: "Branch deletion regression", body: "The announcement must survive" } });

        await systemPrisma.branch.delete({ where: { id: branch.id } });

        const reloaded = await systemPrisma.announcement.findUnique({ where: { id: announcement.id } });
        assert.ok(reloaded, "The Announcement must survive Branch deletion");
        assert.equal(reloaded.branchId, null);
        assert.equal(reloaded.organizationId, organizationId);
        assert.equal(reloaded.authorId, author.id);
      } finally {
        await cleanup(organizationId);
      }
    });
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    for (const organizationId of orgIds) await cleanup(organizationId);
  }
});
