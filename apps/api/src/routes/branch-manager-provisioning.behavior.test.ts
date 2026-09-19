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

const ORG = "organization-branch-provision-test";
const ACTOR = "super-admin-branch-provision-test";
const BRANCH = "branch-provision-test";
const MANAGER = "manager-provision-test";
const MANAGER_EMAIL = "manager.provision@example.com";

function patcher() {
  const restores: Array<() => void> = [];
  return {
    patch(target: any, property: string, replacement: (...args: any[]) => any) {
      const original = target[property];
      target[property] = replacement;
      restores.unshift(() => { target[property] = original; });
    },
    restore() { restores.forEach(restore => restore()); },
  };
}

test("branch creation provisions a tenant-owned Branch Admin atomically", async t => {
  const { patch, restore } = patcher();
  let currentRole: Role = Role.SUPER_ADMIN;
  let branchCreateData: any;
  let userCreateData: any;
  let assignmentCreateData: any;
  let setupTokenData: any;
  let transactionCalls = 0;

  patch((systemPrisma as any).user, "findFirst", async () => ({ isActive: true, role: currentRole }));
  patch((systemPrisma as any).organization, "findUnique", async () => ({ id: ORG, isActive: true, deletedAt: null, subscriptionStatus: "ACTIVE", trialEndsAt: null, subscriptionEndsAt: null }));
  patch((systemPrisma as any).tenantAccessAudit, "create", async () => ({}));

  patch((prisma as any).user, "findFirst", async ({ where }: any) => {
    assert.equal(where.email, MANAGER_EMAIL);
    return null;
  });
  patch((prisma as any), "$transaction", async (value: any) => {
    transactionCalls++;
    if (typeof value !== "function") throw new Error("Unexpected array transaction in branch provisioning test");
    const tx = {
      branch: {
        create: async ({ data }: any) => { branchCreateData = data; return { id: BRANCH }; },
      },
      user: {
        create: async ({ data }: any) => {
          userCreateData = data;
          return { id: MANAGER, organizationId: ORG, name: data.name, email: data.email, role: data.role, isActive: data.isActive };
        },
      },
      branchUser: {
        upsert: async ({ create }: any) => { assignmentCreateData = create; return create; },
      },
      auditLog: { create: async () => ({}) },
    };
    return value(tx);
  });
  patch((prisma as any).passwordResetToken, "deleteMany", async () => ({ count: 0 }));
  patch((prisma as any).passwordResetToken, "create", async ({ data }: any) => { setupTokenData = data; return { id: "setup-token", ...data }; });
  patch((prisma as any).auditLog, "create", async () => ({}));
  patch((prisma as any).branch, "findFirst", async ({ where }: any) => {
    if (where.id !== BRANCH || where.organizationId !== ORG) return null;
    return {
      id: BRANCH,
      branchCode: "B01",
      branchName: "Branch One",
      address: "123 Release Road",
      city: "Ghaziabad",
      state: "Uttar Pradesh",
      pincode: "201001",
      phone: "9876543210",
      email: "branch@example.com",
      managerName: "Branch Manager",
      openingDate: new Date("2026-09-20T00:00:00.000Z"),
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      users: [{ user: { id: MANAGER, email: MANAGER_EMAIL } }],
      _count: { students: 0, teachers: 0, batches: 0 },
    };
  });

  const app = express();
  app.use(express.json());
  app.use("/admin", admin);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(() => { restore(); server.close(); });

  const token = () => jwt.sign({ userId: ACTOR, role: currentRole, organizationId: ORG }, env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
  const payload = {
    branchCode: "B01",
    branchName: "Branch One",
    address: "123 Release Road",
    city: "Ghaziabad",
    state: "Uttar Pradesh",
    pincode: "201001",
    phone: "9876543210",
    email: "branch@example.com",
    managerName: "Branch Manager",
    managerEmail: MANAGER_EMAIL,
    openingDate: "2026-09-20",
    isActive: true,
  };

  let response = await fetch(`${origin}/admin/branches`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
    body: JSON.stringify(payload),
  });
  assert.equal(response.status, 201);
  const body = await response.json() as any;
  assert.equal(body.data.id, BRANCH);
  assert.equal(body.data.managerEmail, MANAGER_EMAIL);
  assert.equal(branchCreateData.organizationId, ORG);
  assert.equal(userCreateData.organizationId, ORG);
  assert.equal(userCreateData.role, Role.BRANCH_ADMIN);
  assert.equal(assignmentCreateData.organizationId, ORG);
  assert.equal(assignmentCreateData.branchId, BRANCH);
  assert.equal(assignmentCreateData.userId, MANAGER);
  assert.equal(setupTokenData.organizationId, ORG);
  assert.equal(setupTokenData.userId, MANAGER);
  assert.equal(transactionCalls, 1);

  currentRole = Role.BRANCH_ADMIN;
  response = await fetch(`${origin}/admin/branches`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
    body: JSON.stringify({ ...payload, branchCode: "B02", managerEmail: "manager2@example.com" }),
  });
  assert.equal(response.status, 403);
  assert.equal(((await response.json()) as any).error.code, "SUPER_ADMIN_REQUIRED");
  assert.equal(transactionCalls, 1);
});
