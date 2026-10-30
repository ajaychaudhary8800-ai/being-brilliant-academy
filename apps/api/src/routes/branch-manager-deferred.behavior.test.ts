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
import admin from "./admin.js";

test("explicit manager deferral creates only a tenant-owned branch, audited, without account or email", async t => {
  const ORG = "organization-deferred-branch-test";
  const ACTOR = "super-admin-deferred-branch-test";
  const BRANCH = "deferred-branch-test";
  let currentRole: Role = Role.SUPER_ADMIN;
  let createCount = 0;
  let userLookupCount = 0;
  let userCreateCount = 0;
  let managerAssignmentCount = 0;
  let emailTokenCount = 0;
  let transactionCount = 0;
  let createdData: any;
  const auditEvents: any[] = [];
  const restore: Array<() => void> = [];
  const patch = (target: any, prop: string, fn: (...args: any[]) => any) => {
    const original = target[prop];
    target[prop] = fn;
    restore.unshift(() => { target[prop] = original; });
  };
  patch((systemPrisma as any).user, "findFirst", async () => ({ isActive: true, role: currentRole }));
  patch((systemPrisma as any).organization, "findUnique", async () => ({
    id: ORG, isActive: true, deletedAt: null, subscriptionStatus: "ACTIVE",
    trialEndsAt: null, subscriptionEndsAt: null,
  }));
  patch((systemPrisma as any).tenantAccessAudit, "create", async () => ({}));
  patch((systemPrisma as any).passwordResetToken, "create", async () => {
    emailTokenCount++;
    throw new Error("Unexpected account setup token");
  });
  patch((prisma as any), "$transaction", async (work: any) => {
    transactionCount++;
    assert.equal(typeof work, "function");
    return work({
      branch: { create: async ({ data }: any) => {
        createCount++;
        createdData = data;
        return { id: BRANCH };
      } },
      user: {
        findFirst: async () => { userLookupCount++; throw new Error("Manager lookup not expected"); },
        create: async () => { userCreateCount++; throw new Error("Manager creation not expected"); },
      },
      branchUser: { upsert: async () => { managerAssignmentCount++; throw new Error("Assignment not expected"); } },
      auditLog: { create: async ({ data }: any) => { auditEvents.push(data); return {}; } },
    });
  });
  patch((prisma as any).branch, "findFirst", async ({ where }: any) => {
    assert.equal(where.organizationId, ORG);
    assert.equal(where.id, BRANCH);
    return {
      id: BRANCH, branchCode: "BBA-UAT-NDG", branchName: "BBA Nandgram — Staging UAT",
      address: "Synthetic test address", city: "Ghaziabad", state: "Uttar Pradesh",
      pincode: "201001", phone: "9999999999", email: "branch@example.test",
      managerName: null, openingDate: new Date("2026-10-30T00:00:00Z"),
      isActive: true, createdAt: new Date(), updatedAt: new Date(),
      users: [], _count: { students: 0, teachers: 0, batches: 0 },
    };
  });

  const app = express();
  app.use(express.json());
  app.use("/admin", admin);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => { for (const fn of restore) fn(); server.close(); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const token = () => jwt.sign(
    { userId: ACTOR, role: currentRole, organizationId: ORG },
    env.JWT_ACCESS_SECRET, { expiresIn: "5m" },
  );
  const payload = {
    branchCode: "BBA-UAT-NDG", branchName: "BBA Nandgram — Staging UAT",
    address: "Synthetic test address", city: "Ghaziabad", state: "Uttar Pradesh",
    pincode: "201001", phone: "9999999999", email: "branch@example.test",
    openingDate: "2026-10-30", isActive: true,
  };
  const post = async (body: Record<string, unknown>) => fetch(`${origin}/admin/branches`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
    body: JSON.stringify(body),
  });

  // Missing manager is never implicitly accepted.
  let response = await post(payload);
  assert.equal(response.status, 422);
  assert.equal(createCount, 0);

  // Credentials and a deferred flag cannot be combined to silently skip provisioning.
  response = await post({ ...payload, deferManagerProvisioning: true, managerEmail: "someone@example.test" });
  assert.equal(response.status, 422);
  response = await post({ ...payload, deferManagerProvisioning: true, managerName: "Unappointed Manager" });
  assert.equal(response.status, 422);
  assert.equal(transactionCount, 0);

  // Only tenant SUPER_ADMIN may create even managerless branches.
  currentRole = Role.BRANCH_ADMIN;
  response = await post({ ...payload, deferManagerProvisioning: true });
  assert.equal(response.status, 403);
  assert.equal((await response.json() as any).error.code, "SUPER_ADMIN_REQUIRED");
  assert.equal(transactionCount, 0);

  currentRole = Role.SUPER_ADMIN;
  response = await post({ ...payload, deferManagerProvisioning: true });
  assert.equal(response.status, 201);
  const result = await response.json() as any;
  assert.equal(result.data.id, BRANCH);
  assert.equal(result.data.managerEmail, null);
  assert.equal(result.data.managerUserId, null);
  assert.equal(result.data.setup.reason, "MANAGER_PROVISIONING_DEFERRED");
  assert.equal(result.data.setup.skipped, true);
  assert.equal(createdData.organizationId, ORG);
  assert.equal(createdData.managerName, undefined);
  assert.equal(createCount, 1);
  assert.equal(transactionCount, 1);
  assert.equal(userLookupCount, 0);
  assert.equal(userCreateCount, 0);
  assert.equal(managerAssignmentCount, 0);
  assert.equal(emailTokenCount, 0);
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].action, "BRANCH_CREATED");
  assert.equal(auditEvents[0].actorId, ACTOR);
  assert.equal(auditEvents[0].metadata.managerProvisioningDeferred, true);
});
