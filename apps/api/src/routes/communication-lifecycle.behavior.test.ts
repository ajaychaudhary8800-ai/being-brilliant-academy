import "express-async-errors";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Role } from "@prisma/client";
import express from "express";
import jwt from "jsonwebtoken";
import { env } from "../config.js";
import { errorHandler } from "../lib/http.js";
import { prisma, systemPrisma } from "../lib/prisma.js";
import communication from "./communication.js";
import notices from "./notice-board.js";
import portals from "./portals.js";

const ORGANIZATION_ID = "organization-communication-lifecycle-test";
const STUDENT_ID = "student-communication-lifecycle-test";
const RECIPIENT_ID = "recipient-communication-lifecycle-test";
const BRANCH_ID = "branch-communication-lifecycle-test";
const BATCH_ID = "batch-communication-lifecycle-test";

function matches(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== "object" || expected instanceof Date) return actual === expected;
  const condition = expected as Record<string, any>;
  if (Array.isArray(condition.OR)) return condition.OR.some(item => matches(actual, item));
  if (Array.isArray(condition.AND)) return condition.AND.every(item => matches(actual, item));
  if (Array.isArray(condition.in)) return condition.in.includes(actual);
  if ("not" in condition && matches(actual, condition.not)) return false;
  if ("lte" in condition && !(actual instanceof Date && actual <= condition.lte)) return false;
  if ("gt" in condition && !(actual instanceof Date && actual > condition.gt)) return false;
  return Object.entries(condition)
    .filter(([key]) => !["in", "not", "lte", "gt"].includes(key))
    .every(([key, value]) => matches((actual as any)?.[key], value));
}

function matchesWhere(record: Record<string, any>, where: Record<string, any>): boolean {
  return Object.entries(where).every(([key, expected]) => key === "OR"
    ? (expected as Record<string, any>[]).some(item => matchesWhere(record, item))
    : key === "AND"
      ? (expected as Record<string, any>[]).every(item => matchesWhere(record, item))
      : matches(record[key], expected));
}

test("canonical and legacy communication routes enforce lifecycle and private history", async t => {
  const now = Date.now();
  const notifications = [
    { id: "valid", userId: STUDENT_ID, title: "Valid", body: "Visible", scheduledAt: new Date(now - 60_000), expiresAt: new Date(now + 60_000), isArchived: false, deletedAt: null, readAt: null, createdAt: new Date(now - 60_000) },
    { id: "future", userId: STUDENT_ID, title: "Future", body: "Hidden", scheduledAt: new Date(now + 60_000), expiresAt: null, isArchived: false, deletedAt: null, readAt: null, createdAt: new Date(now) },
    { id: "expired", userId: STUDENT_ID, title: "Expired", body: "Hidden", scheduledAt: null, expiresAt: new Date(now - 60_000), isArchived: false, deletedAt: null, readAt: null, createdAt: new Date(now) },
    { id: "archived", userId: STUDENT_ID, title: "Archived", body: "Hidden", scheduledAt: null, expiresAt: null, isArchived: true, deletedAt: null, readAt: null, createdAt: new Date(now) },
    { id: "deleted", userId: STUDENT_ID, title: "Deleted", body: "Hidden", scheduledAt: null, expiresAt: null, isArchived: false, deletedAt: new Date(now - 60_000), readAt: null, createdAt: new Date(now) },
    { id: "archived-expired", userId: STUDENT_ID, title: "Archived expired", body: "Hidden", scheduledAt: null, expiresAt: new Date(now - 60_000), isArchived: true, deletedAt: null, readAt: null, createdAt: new Date(now) },
    { id: "archived-deleted", userId: STUDENT_ID, title: "Archived deleted", body: "Hidden", scheduledAt: null, expiresAt: null, isArchived: true, deletedAt: new Date(now - 60_000), readAt: null, createdAt: new Date(now) },
    { id: "other-user", userId: RECIPIENT_ID, title: "Other user", body: "Hidden", scheduledAt: null, expiresAt: null, isArchived: false, deletedAt: null, readAt: null, createdAt: new Date(now) },
  ];
  const deliveries = [
    { id: "delivery-valid", status: "QUEUED", attempts: 0, notification: notifications[0] },
    { id: "delivery-future", status: "QUEUED", attempts: 0, notification: notifications[1] },
    { id: "delivery-expired", status: "QUEUED", attempts: 0, notification: notifications[2] },
  ];
  const circulars = [
    { id: "draft", audience: Role.STUDENT, branchId: BRANCH_ID, publishedAt: null, expiresAt: null, isArchived: false, deletedAt: null },
    { id: "published", audience: Role.STUDENT, branchId: BRANCH_ID, publishedAt: new Date(now - 60_000), expiresAt: null, isArchived: false, deletedAt: null },
  ];
  const noticeRecords = [
    { id: "active-notice", kind: "NOTICE", audience: Role.STUDENT, branchId: BRANCH_ID, batchId: BATCH_ID, publishedAt: new Date(now - 60_000), expiresAt: null, isArchived: false, deletedAt: null },
    { id: "archived-notice", kind: "NOTICE", audience: Role.STUDENT, branchId: BRANCH_ID, batchId: BATCH_ID, publishedAt: new Date(now - 60_000), expiresAt: null, isArchived: true, deletedAt: null },
  ];
  const message = { id: "message-a", senderId: STUDENT_ID, recipientId: RECIPIENT_ID, senderArchived: false, recipientArchived: false, readAt: null, deletedAt: null };
  const messageUpdates: Record<string, any>[] = [];
  const patches: Array<() => void> = [];
  const patch = (target: any, property: string, replacement: (...args: any[]) => any) => {
    const original = target[property];
    target[property] = replacement;
    patches.unshift(() => { target[property] = original; });
  };

  patch((systemPrisma as any).user, "findFirst", async () => ({ isActive: true }));
  patch((systemPrisma as any).organization, "findUnique", async () => ({ id: ORGANIZATION_ID, isActive: true, deletedAt: null, subscriptionStatus: "ACTIVE", trialEndsAt: null, subscriptionEndsAt: null }));
  patch((systemPrisma as any).tenantAccessAudit, "create", async () => ({}));
  patch((prisma as any).studentProfile, "findUnique", async () => ({ branchId: BRANCH_ID, batchId: BATCH_ID, status: "ACTIVE" }));
  patch((prisma as any).branchUser, "findMany", async () => [{ branchId: BRANCH_ID }]);
  patch((prisma as any).notification, "findMany", async ({ where }: any) => notifications.filter(record => matchesWhere(record, where)));
  patch((prisma as any).notification, "count", async ({ where }: any) => notifications.filter(record => matchesWhere(record, where)).length);
  patch((prisma as any).notification, "findFirst", async ({ where }: any) => notifications.find(record => matchesWhere(record, where)) ?? null);
  patch((prisma as any).notification, "update", async ({ where, data }: any) => { const record = notifications.find(item => item.id === where.id); if (!record) throw new Error("notification not found"); Object.assign(record, data); return record; });
  patch((prisma as any).notificationDelivery, "findMany", async ({ where }: any) => deliveries.filter(record => matchesWhere(record, where)));
  patch((prisma as any).notificationDelivery, "updateMany", async ({ where, data }: any) => { const selected = deliveries.filter(record => matchesWhere(record, where)); for (const record of selected) { record.status = data.status; if (data.attempts?.increment) record.attempts += data.attempts.increment; } return { count: selected.length }; });
  patch((prisma as any).circular, "findMany", async ({ where }: any) => circulars.filter(record => matchesWhere(record, where)));
  patch((prisma as any).circular, "count", async ({ where }: any) => circulars.filter(record => matchesWhere(record, where)).length);
  patch((prisma as any).announcement, "findMany", async ({ where }: any) => noticeRecords.filter(record => matchesWhere(record, where)));
  patch((prisma as any).announcement, "count", async ({ where }: any) => noticeRecords.filter(record => matchesWhere(record, where)).length);
  patch((prisma as any).portalMessage, "findUnique", async ({ where }: any) => where.id === message.id ? message : null);
  patch((prisma as any).portalMessage, "update", async ({ data }: any) => { messageUpdates.push(data); Object.assign(message, data); return message; });
  patch(prisma as any, "$transaction", async (operations: Promise<unknown>[]) => Promise.all(operations));

  const application = express();
  application.use(express.json());
  application.use("/api/v1", communication);
  application.use("/api/v1", notices);
  application.use("/api/v1/portal", portals);
  application.use(errorHandler);
  const server = application.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const port = (server.address() as AddressInfo).port;
  const token = (userId: string, role: Role) => jwt.sign({ userId, role, organizationId: ORGANIZATION_ID }, env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
  const request = (path: string, userId = STUDENT_ID, role: Role = Role.STUDENT, init?: RequestInit) => fetch(`http://127.0.0.1:${port}/api/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token(userId, role)}`, "Content-Type": "application/json", ...init?.headers },
  });

  try {
    await t.test("canonical and portal inboxes return only currently active notifications", async () => {
      for (const path of ["/communication/notifications", "/portal/notifications"]) {
        const response = await request(path);
        assert.equal(response.status, 200, path);
        const payload = await response.json() as any;
        assert.deepEqual(payload.data.map((item: any) => item.id), ["valid"], path);
      }
    });

    await t.test("canonical archived inbox returns only lifecycle-valid archived notifications", async () => {
      const response = await request("/communication/notifications?archived=true");
      assert.equal(response.status, 200);
      const payload = await response.json() as any;
      assert.deepEqual(payload.data.map((item: any) => item.id), ["archived"]);
    });

    await t.test("canonical and legacy read mutations reject hidden or foreign notifications", async () => {
      for (const pathPrefix of ["/communication/notifications", "/portal/notifications"]) {
        for (const notificationId of ["future", "expired", "archived", "deleted", "other-user"]) {
          const path = pathPrefix === "/communication/notifications" ? `${pathPrefix}/${notificationId}` : `${pathPrefix}/${notificationId}/read`;
          const response = await request(path, STUDENT_ID, Role.STUDENT, { method: "PATCH", body: pathPrefix === "/communication/notifications" ? JSON.stringify({ read: true }) : undefined });
          assert.equal(response.status, 404, `${pathPrefix} ${notificationId}`);
        }
        const activePath = pathPrefix === "/communication/notifications" ? `${pathPrefix}/valid` : `${pathPrefix}/valid/read`;
        const response = await request(activePath, STUDENT_ID, Role.STUDENT, { method: "PATCH", body: pathPrefix === "/communication/notifications" ? JSON.stringify({ read: true }) : undefined });
        assert.equal(response.status, 200, pathPrefix);
        assert.ok((notifications[0] as { readAt: Date | null }).readAt instanceof Date);
      }
    });

    await t.test("canonical notification archive remains reversible", async () => {
      let response = await request("/communication/notifications/valid", STUDENT_ID, Role.STUDENT, { method: "PATCH", body: JSON.stringify({ archived: true }) });
      assert.equal(response.status, 200);
      assert.equal(notifications[0].isArchived, true);
      response = await request("/communication/notifications/valid", STUDENT_ID, Role.STUDENT, { method: "PATCH", body: JSON.stringify({ archived: false }) });
      assert.equal(response.status, 200);
      assert.equal(notifications[0].isArchived, false);
    });

    await t.test("manual delivery processing advances only lifecycle-valid queued deliveries", async () => {
      const response = await request("/communication/deliveries/process", "manager", Role.SUPER_ADMIN, { method: "POST" });
      assert.equal(response.status, 200);
      assert.equal((await response.json() as any).data.processed, 1);
      assert.equal(deliveries[0].status, "READY");
      assert.equal(deliveries[0].attempts, 1);
      assert.equal(deliveries[1].status, "QUEUED");
      assert.equal(deliveries[2].status, "QUEUED");
    });

    await t.test("recipient circular list hides drafts while an authorized manager can list them", async () => {
      let response = await request("/communication/circulars");
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json() as any).data.map((item: any) => item.id), ["published"]);
      response = await request("/communication/circulars", "manager", Role.SUPER_ADMIN);
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json() as any).data.map((item: any) => item.id), ["draft", "published"]);
    });

    await t.test("archived notice query manipulation is ignored for recipients but honored for managers", async () => {
      let response = await request("/notices?archived=true");
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json() as any).data.map((item: any) => item.id), ["active-notice"]);
      response = await request("/notices?archived=true", "manager", Role.SUPER_ADMIN);
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json() as any).data.map((item: any) => item.id), ["archived-notice"]);
    });

    await t.test("canonical and legacy message actions archive only the acting participant", async () => {
      let response = await request(`/communication/messages/${message.id}`, STUDENT_ID, Role.STUDENT, { method: "PATCH", body: JSON.stringify({ archive: true }) });
      assert.equal(response.status, 200);
      assert.deepEqual(messageUpdates.at(-1), { senderArchived: true });
      response = await request(`/portal/messages/${message.id}`, RECIPIENT_ID, Role.STUDENT, { method: "PATCH", body: JSON.stringify({ archived: true, read: true }) });
      assert.equal(response.status, 200);
      const recipientUpdate = messageUpdates.at(-1);
      assert.ok(recipientUpdate);
      assert.equal(recipientUpdate.recipientArchived, true);
      assert.ok(recipientUpdate.readAt instanceof Date);
      assert.equal("deletedAt" in recipientUpdate, false);
      const updatesBeforeDelete = messageUpdates.length;
      response = await request(`/communication/messages/${message.id}`, STUDENT_ID, Role.STUDENT, { method: "PATCH", body: JSON.stringify({ deleted: true }) });
      assert.equal(response.status, 422);
      assert.equal(messageUpdates.length, updatesBeforeDelete);
      assert.equal(message.deletedAt, null);
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const restore of patches) restore();
  }
});
