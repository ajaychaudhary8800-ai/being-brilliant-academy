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

const ORG = "organization-bba-existing-branch-manager-test";
const ACTOR = "bba-synthetic-super-admin-test";
const BRANCH = "cmvupthu804jnnx075pvgu643";
const MAIL = "controlled-manager@example.test";
const MANAGER = "manager-existing-bba-test";
const NEW_MANAGER = "new-manager-bba-test";

test("existing BBA deferred branch manager appointment rejects privilege escalation and is idempotent", async t => {
  let role: Role = Role.SUPER_ADMIN;
  let foundBranch = true;
  let branchIsActive = true;
  let candidate: any = { id: MANAGER, email: MAIL, organizationId: ORG, role: Role.BRANCH_ADMIN, isActive: true };
  let assigned: any[] = [];
  let transactions = 0;
  let managerCreates = 0;
  let assignmentCreates = 0;
  let auditWrites = 0;
  let setupTokenWrites = 0;
  let branchUpdates = 0;
  const restores: Array<() => void> = [];
  const patch = (target: any, property: string, replacement: (...args: any[]) => any) => {
    const original = target[property];
    target[property] = replacement;
    restores.unshift(() => { target[property] = original; });
  };

  patch((systemPrisma as any).organization, "findUnique", async () => ({
    id: ORG, isActive: true, deletedAt: null, subscriptionStatus: "ACTIVE",
    trialEndsAt: null, subscriptionEndsAt: null,
  }));
  patch((systemPrisma as any).user, "findFirst", async () => ({ role, isActive: true }));
  patch((systemPrisma as any).tenantAccessAudit, "create", async () => ({}));
  patch((systemPrisma as any).passwordResetToken, "deleteMany", async () => ({ count: 0 }));
  // Deliberate failure prevents any provider email/network action. We only
  // validate the resilient typed result when one-time setup cannot be sent.
  patch((systemPrisma as any).passwordResetToken, "create", async () => {
    setupTokenWrites++;
    throw new Error("Synthetic setup delivery intentionally unavailable");
  });

  patch((prisma as any), "$transaction", async (fn: any, options: any) => {
    assert.equal(typeof fn, "function");
    assert.equal(options.isolationLevel, "Serializable");
    transactions++;
    return fn({
      branch: {
        findFirst: async ({ where }: any) => {
          assert.equal(where.organizationId, ORG);
          return foundBranch && where.id === BRANCH
            ? { id: BRANCH, organizationId: ORG, isActive: branchIsActive }
            : null;
        },
        update: async ({ where, data }: any) => {
          assert.equal(where.id, BRANCH);
          assert.ok(data.managerName);
          branchUpdates++;
          return { id: BRANCH };
        },
      },
      branchUser: {
        findMany: async ({ where }: any) => {
          assert.equal(where.organizationId, ORG);
          assert.equal(where.branchId, BRANCH);
          return assigned.map(user => ({ user }));
        },
        create: async ({ data }: any) => {
          assert.equal(data.organizationId, ORG);
          assert.equal(data.branchId, BRANCH);
          assignmentCreates++;
          const account = candidate?.id === data.userId
            ? candidate
            : { id: data.userId, email: MAIL, role: Role.BRANCH_ADMIN, organizationId: ORG, isActive: true };
          assigned.push(account);
          return data;
        },
      },
      user: {
        findFirst: async ({ where }: any) => {
          return where.email === MAIL ? candidate : null;
        },
        create: async ({ data }: any) => {
          managerCreates++;
          assert.equal(data.organizationId, ORG);
          assert.equal(data.role, Role.BRANCH_ADMIN);
          assert.ok(data.passwordHash && data.passwordHash.length > 40);
          candidate = { id: NEW_MANAGER, email: data.email, role: data.role, organizationId: data.organizationId, isActive: true };
          return candidate;
        },
      },
      auditLog: {
        create: async ({ data }: any) => {
          assert.equal(data.organizationId, ORG);
          assert.equal(data.action, "BRANCH_MANAGER_APPOINTED");
          auditWrites++;
          return {};
        },
      },
    });
  });
  patch((prisma as any).branch, "findFirst", async ({ where }: any) => {
    assert.equal(where.id, BRANCH);
    assert.equal(where.organizationId, ORG);
    return {
      id: BRANCH, branchCode: "BBA-UAT-NDG", branchName: "BBA Nandgram UAT",
      address: "Synthetic test campus", city: "Ghaziabad", state: "UP",
      pincode: "201001", phone: "9999999999", email: "synthetic-branch@example.test",
      managerName: "Synthetic Controlled Manager", openingDate: new Date(), isActive: true,
      createdAt: new Date(), updatedAt: new Date(),
      users: assigned.map(user => ({ user: { id: user.id, email: user.email } })),
      _count: { students: 1, teachers: 1, batches: 1 },
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
  t.after(() => { restores.forEach(restore => restore()); server.close(); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (email = MAIL, extra: object = {}) => {
    const token = jwt.sign(
      { userId: ACTOR, role, organizationId: ORG },
      env.JWT_ACCESS_SECRET, { expiresIn: "5m" },
    );
    const response = await fetch(`${origin}/admin/branches/${BRANCH}/manager`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ managerName: "Synthetic Controlled Manager", managerEmail: email, ...extra }),
    });
    return { status: response.status, payload: await response.json() as any };
  };

  role = Role.BRANCH_ADMIN;
  let res = await post();
  assert.equal(res.status, 403);
  assert.equal(res.payload.error.code, "SUPER_ADMIN_REQUIRED");
  assert.equal(transactions, 0);

  role = Role.SUPER_ADMIN;
  res = await post(MAIL, { unauthorizedRole: Role.BRANCH_ADMIN });
  assert.equal(res.status, 422);
  assert.equal(transactions, 0);

  foundBranch = false;
  res = await post();
  assert.equal(res.status, 404);
  assert.equal(res.payload.error.code, "BRANCH_NOT_FOUND");
  foundBranch = true;

  branchIsActive = false;
  res = await post();
  assert.equal(res.status, 409);
  assert.equal(res.payload.error.code, "INACTIVE_BRANCH_MANAGER_PROHIBITED");
  branchIsActive = true;

  candidate = { ...candidate, organizationId: "unrelated-tenant" };
  res = await post();
  assert.equal(res.status, 409);
  assert.equal(res.payload.error.code, "MANAGER_EMAIL_EXISTS");

  candidate = { ...candidate, organizationId: ORG, role: Role.TEACHER };
  res = await post();
  assert.equal(res.status, 409);
  assert.equal(res.payload.error.code, "MANAGER_EMAIL_EXISTS");

  candidate = { ...candidate, role: Role.BRANCH_ADMIN, isActive: false };
  res = await post();
  assert.equal(res.status, 409);
  assert.equal(res.payload.error.code, "MANAGER_ACCOUNT_INACTIVE");

  candidate = { ...candidate, isActive: true };
  res = await post();
  assert.equal(res.status, 201);
  assert.equal(res.payload.data.managerUserId, MANAGER);
  assert.equal(res.payload.data.managerCreated, false);
  assert.equal(res.payload.data.setup.reason, "EXISTING_MANAGER_ACCOUNT");
  assert.equal(assignmentCreates, 1);
  assert.equal(managerCreates, 0);
  assert.equal(auditWrites, 1);

  res = await post();
  assert.equal(res.status, 200);
  assert.equal(res.payload.data.managerAlreadyAssigned, true);
  assert.equal(res.payload.data.setup.reason, "ALREADY_ASSIGNED");
  assert.equal(assignmentCreates, 1);
  assert.equal(auditWrites, 1);

  res = await post("different-manager@example.test");
  assert.equal(res.status, 409);
  assert.equal(res.payload.error.code, "BRANCH_MANAGER_ALREADY_ASSIGNED");
  assert.equal(assignmentCreates, 1);
  assert.equal(managerCreates, 0);
  assert.equal(setupTokenWrites, 0);

  // Reuse the same isolated mock branch with no manager to prove creation
  // commits a manager and an assignment even when delivery is unavailable.
  assigned = [];
  candidate = null;
  res = await post();
  assert.equal(res.status, 201);
  assert.equal(res.payload.data.managerCreated, true);
  assert.equal(res.payload.data.setup.reason, "EMAIL_DELIVERY_FAILED");
  assert.equal(managerCreates, 1);
  assert.equal(assignmentCreates, 2);
  assert.equal(branchUpdates, 2);
  assert.equal(auditWrites, 2);
  assert.equal(setupTokenWrites, 1);
});
