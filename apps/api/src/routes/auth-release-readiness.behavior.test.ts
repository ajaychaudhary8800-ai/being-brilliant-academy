import "express-async-errors";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import express from "express";
import jwt from "jsonwebtoken";
import { env } from "../config.js";
import { errorHandler } from "../lib/http.js";
import { systemPrisma } from "../lib/prisma.js";
import { allow, requireAuth } from "../middleware/auth.js";
import auth from "./auth.js";

const ORG = "organization-auth-release-test";
const USER = "user-auth-release-test";
const EMAIL = "auth-release@example.com";
const PASSWORD = "StrongPass123";
const activeOrg = {
  id: ORG,
  slug: "auth-release-test",
  name: "Auth Release Test",
  logoUrl: null,
  primaryColor: null,
  isActive: true,
  deletedAt: null,
  subscriptionStatus: "ACTIVE",
  trialEndsAt: null,
  subscriptionEndsAt: null,
};

function patcher() {
  const restores: Array<() => void> = [];
  return {
    patch(target: any, property: string, replacement: (...args: any[]) => any) {
      const original = target[property];
      target[property] = replacement;
      restores.unshift(() => { target[property] = original; });
    },
    restore() { for (const restore of restores) restore(); },
  };
}

async function serverFor(application: express.Express) {
  const server = application.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  return {
    server,
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
}

test("requireAuth invalidates stale role claims immediately", async t => {
  const { patch, restore } = patcher();
  let dbRole: Role = Role.SUPER_ADMIN;
  patch((systemPrisma as any).user, "findFirst", async () => ({ isActive: true, role: dbRole }));
  patch((systemPrisma as any).organization, "findUnique", async () => activeOrg);
  patch((systemPrisma as any).tenantAccessAudit, "create", async () => ({}));

  const app = express();
  app.get("/protected", requireAuth, allow(Role.SUPER_ADMIN), (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  const { server, origin } = await serverFor(app);
  t.after(() => { restore(); server.close(); });

  const token = () => jwt.sign({ userId: USER, role: Role.SUPER_ADMIN, organizationId: ORG }, env.JWT_ACCESS_SECRET, { expiresIn: "5m" });

  let response = await fetch(`${origin}/protected`, { headers: { Authorization: `Bearer ${token()}` } });
  assert.equal(response.status, 200);

  dbRole = Role.BRANCH_ADMIN;
  response = await fetch(`${origin}/protected`, { headers: { Authorization: `Bearer ${token()}` } });
  assert.equal(response.status, 401);
  const body = await response.json() as any;
  assert.equal(body.error.code, "STALE_ROLE_TOKEN");
});

test("auth routes enforce provisioned accounts, portal eligibility and bounded refresh sessions", async t => {
  const { patch, restore } = patcher();
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  let userRole: Role = Role.BRANCH_ADMIN;
  let studentProfile: unknown = { id: "student-profile" };
  let sessionCreated: any = null;
  const originalExpiry = new Date(Date.now() + 3 * 864e5);

  patch((systemPrisma as any).organization, "findUnique", async () => activeOrg);
  patch((systemPrisma as any).user, "findFirst", async () => ({
    id: USER,
    organizationId: ORG,
    name: "Auth User",
    email: EMAIL,
    passwordHash,
    role: userRole,
    isActive: true,
  }));
  patch((systemPrisma as any).studentProfile, "findFirst", async () => studentProfile);
  patch((systemPrisma as any).teacherProfile, "findFirst", async () => ({ id: "teacher-profile" }));
  patch((systemPrisma as any).parentStudent, "findFirst", async () => ({ id: "parent-link" }));
  patch((systemPrisma as any).session, "create", async ({ data }: any) => { sessionCreated = data; return { id: "session-created", ...data }; });
  patch((systemPrisma as any).session, "delete", async () => ({}));
  patch((systemPrisma as any).session, "findUnique", async () => ({
    id: "session-old",
    organizationId: ORG,
    userId: USER,
    expiresAt: originalExpiry,
    user: {
      id: USER,
      organizationId: ORG,
      name: "Auth User",
      email: EMAIL,
      role: Role.BRANCH_ADMIN,
      isActive: true,
      organization: activeOrg,
    },
  }));

  const app = express();
  app.use(express.json());
  app.use("/auth", auth);
  app.use(errorHandler);
  const { server, origin } = await serverFor(app);
  t.after(() => { restore(); server.close(); });

  let response = await fetch(`${origin}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Orphan Learner", email: "orphan@example.com", password: PASSWORD, organization: activeOrg.slug }),
  });
  assert.equal(response.status, 403);
  assert.equal(((await response.json()) as any).error.code, "SELF_REGISTRATION_DISABLED");

  response = await fetch(`${origin}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, organization: activeOrg.slug, portal: "student" }),
  });
  assert.equal(response.status, 403);
  assert.equal(((await response.json()) as any).error.code, "WRONG_PORTAL");

  userRole = Role.STUDENT;
  studentProfile = null;
  response = await fetch(`${origin}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, organization: activeOrg.slug, portal: "student" }),
  });
  assert.equal(response.status, 403);
  assert.equal(((await response.json()) as any).error.code, "STUDENT_INACTIVE");

  userRole = Role.BRANCH_ADMIN;
  sessionCreated = null;
  response = await fetch(`${origin}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, organization: activeOrg.slug, portal: "admin", rememberMe: true }),
  });
  assert.equal(response.status, 200);
  const loginBody = await response.json() as any;
  assert.equal(loginBody.data.user.role, Role.BRANCH_ADMIN);
  assert.ok(loginBody.data.accessToken);
  assert.ok(loginBody.data.refreshToken);
  assert.equal(sessionCreated.organizationId, ORG);

  sessionCreated = null;
  response = await fetch(`${origin}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: "x".repeat(48) }),
  });
  assert.equal(response.status, 200);
  assert.ok(sessionCreated);
  assert.equal(new Date(sessionCreated.expiresAt).getTime(), originalExpiry.getTime());
});
