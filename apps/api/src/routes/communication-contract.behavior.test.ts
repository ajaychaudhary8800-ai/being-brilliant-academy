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
import organizations from "./organizations.js";

const ORGANIZATION_ID = "organization-communication-contract-test";
const USER_ID = "user-communication-contract-test";
const organization = {
  id: ORGANIZATION_ID,
  timezone: "Asia/Kolkata",
  locale: "en-IN",
  isActive: true,
  deletedAt: null,
  subscriptionStatus: "ACTIVE",
  trialEndsAt: null,
  subscriptionEndsAt: null,
};

test("Communication initial-load and create endpoint contracts are registered and empty-safe", async t => {
  const patches: Array<() => void> = [];
  const patch = (target: any, property: string, replacement: (...args: any[]) => any) => {
    const original = target[property];
    target[property] = replacement;
    patches.unshift(() => { target[property] = original; });
  };
  patch((systemPrisma as any).user, "findFirst", async () => ({ isActive: true }));
  patch((systemPrisma as any).organization, "findUnique", async () => organization);
  patch((systemPrisma as any).tenantAccessAudit, "create", async () => ({}));
  for (const model of ["announcement", "notification", "portalMessage", "circular", "calendarEvent", "notificationDelivery"]) {
    patch((prisma as any)[model], "count", async () => 0);
  }
  for (const model of ["announcement", "notification", "portalMessage", "circular", "calendarEvent"]) {
    patch((prisma as any)[model], "findMany", async () => []);
  }

  const application = express();
  application.use(express.json());
  application.use("/api/v1", communication);
  application.use("/api/v1", organizations);
  application.use(errorHandler);
  const server = application.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const port = (server.address() as AddressInfo).port;
  const token = jwt.sign({ userId: USER_ID, role: Role.SUPER_ADMIN, organizationId: ORGANIZATION_ID }, env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
  const request = async (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}/api/v1${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers } });

  try {
    await t.test("dashboard, settings and every tab list return successful empty responses", async () => {
      const paths = [
        "/communication/dashboard",
        "/organization/settings",
        "/communication/announcements?search=&page=1&limit=50",
        "/communication/notifications?search=&page=1&limit=50",
        "/communication/messages?search=&page=1&limit=50",
        "/communication/circulars?search=&page=1&limit=50",
        "/communication/events?search=&page=1&limit=50",
      ];
      for (const path of paths) {
        const response = await request(path);
        assert.equal(response.status, 200, path);
        const payload = await response.json() as any;
        if (path.includes("/dashboard")) assert.deepEqual(payload.data, { announcements: 0, unread: 0, messages: 0, circulars: 0, events: 0, queued: 0 });
        if (path.includes("/communication/") && !path.includes("dashboard")) assert.deepEqual(payload.data, []);
      }
    });

    await t.test("announcement, circular and event create paths are registered", async () => {
      for (const path of ["/communication/announcements", "/communication/circulars", "/communication/events"]) {
        const response = await request(path, { method: "POST", body: "{}" });
        assert.equal(response.status, 422, path);
      }
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const restore of patches) restore();
  }
});
