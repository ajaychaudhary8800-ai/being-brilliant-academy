import "express-async-errors";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { FeePlanStatus, Role } from "@prisma/client";
import express from "express";
import jwt from "jsonwebtoken";
import { env } from "../config.js";
import { errorHandler } from "../lib/http.js";
import { prisma, systemPrisma } from "../lib/prisma.js";
import feePlans from "./fee-plans.js";

const ORGANIZATION_A = "organization-fee-plan-test";
const ORGANIZATION_B = "organization-fee-plan-other";
const SUPER_ADMIN = "user-fee-plan-super";
const BRANCH_ADMIN = "user-fee-plan-branch";
const ZERO_BRANCH_ADMIN = "user-fee-plan-zero";
const ACCOUNTANT = "user-fee-plan-accountant";
const OTHER_USER = "user-fee-plan-other";
const BRANCH_A = "branch-fee-plan-a";
const BRANCH_B = "branch-fee-plan-b";

type State = { plans: any[]; installments: any[]; components: any[]; audits: any[] };
type Auth = { role: Role; userId: string; organizationId: string };

function makeHarness() {
  const state: State = { plans: [], installments: [], components: [], audits: [] };
  let sequence = 0;
  let activeAuth: Auth = { role: Role.SUPER_ADMIN, userId: SUPER_ADMIN, organizationId: ORGANIZATION_A };
  let failAudit = false;
  const sessions: Record<string, any> = {
    "session-1": { id: "session-1", organizationId: ORGANIZATION_A, name: "2026-27", startsAt: new Date("2026-04-01"), endsAt: new Date("2027-03-31"), isArchived: false },
    "session-2": { id: "session-2", organizationId: ORGANIZATION_A, name: "2025-26", startsAt: new Date("2025-04-01"), endsAt: new Date("2026-03-31"), isArchived: false },
    "session-b": { id: "session-b", organizationId: ORGANIZATION_B, name: "2026-27", startsAt: new Date("2026-04-01"), endsAt: new Date("2027-03-31"), isArchived: false },
  };
  const organizations: Record<string, any> = {
    [ORGANIZATION_A]: { id: ORGANIZATION_A, isActive: true, deletedAt: null, subscriptionStatus: "ACTIVE", trialEndsAt: null, subscriptionEndsAt: null },
    [ORGANIZATION_B]: { id: ORGANIZATION_B, isActive: true, deletedAt: null, subscriptionStatus: "ACTIVE", trialEndsAt: null, subscriptionEndsAt: null },
  };
  const users = new Set([SUPER_ADMIN, BRANCH_ADMIN, ZERO_BRANCH_ADMIN, ACCOUNTANT, OTHER_USER]);
  const branches = [{ id: BRANCH_A, organizationId: ORGANIZATION_A }, { id: BRANCH_B, organizationId: ORGANIZATION_A }];
  const courses = [{ id: "course-a", organizationId: ORGANIZATION_A, branchId: BRANCH_A }, { id: "course-global", organizationId: ORGANIZATION_A, branchId: null }];
  const batches = [
    { id: "batch-a", organizationId: ORGANIZATION_A, branchId: BRANCH_A, courseId: "course-a", academicSessionId: "session-1" },
    { id: "batch-b", organizationId: ORGANIZATION_A, branchId: BRANCH_B, courseId: null, academicSessionId: "session-1" },
    { id: "batch-old", organizationId: ORGANIZATION_A, branchId: BRANCH_A, courseId: "course-a", academicSessionId: "session-2" },
  ];
  const assignments: Record<string, string[]> = { [BRANCH_ADMIN]: [BRANCH_A], [ACCOUNTANT]: [BRANCH_A], [ZERO_BRANCH_ADMIN]: [] };
  const clone = <T>(value: T): T => structuredClone(value);
  const cloneState = () => clone(state);
  const commit = (next: State) => { state.plans = next.plans; state.installments = next.installments; state.components = next.components; state.audits = next.audits; };
  const matches = (row: any, where: any): boolean => {
    if (!where) return true;
    if (where.OR && !where.OR.some((item: any) => matches(row, item))) return false;
    if (where.installment) {
      const installment = state.installments.find(item => item.id === row.installmentId);
      if (!matches(installment, where.installment)) return false;
    }
    for (const [key, expected] of Object.entries(where)) {
      if (key === "OR" || key === "installment" || key === "id" && (expected as any)?.not) continue;
      if ((expected as any)?.in && !(expected as any).in.includes(row[key])) return false;
      if ((expected as any)?.not && row[key] === (expected as any).not) return false;
      if (!(expected as any)?.in && !(expected as any)?.not && row[key] !== expected) return false;
    }
    return true;
  };
  const materialize = (target: State, plan: any) => {
    const session = Object.values(sessions).find(item => item.id === plan.academicSessionId) ?? sessions["session-1"];
    return { ...clone(plan), academicSession: { id: session.id, name: session.name, startsAt: session.startsAt, endsAt: session.endsAt }, branch: branches.find(item => item.id === plan.branchId) ?? null, course: courses.find(item => item.id === plan.courseId) ?? null, batch: batches.find(item => item.id === plan.batchId) ?? null, installments: target.installments.filter(item => item.planId === plan.id).sort((a, b) => a.sequence - b.sequence).map(item => ({ ...clone(item), components: target.components.filter(component => component.installmentId === item.id).sort((a, b) => a.position - b.position) })) };
  };
  const client = (target: State) => {
    const findPlan = (where: any) => target.plans.find(plan => matches(plan, where));
    return {
      branchUser: { findMany: async () => (assignments[activeAuth.userId] ?? []).map(branchId => ({ branchId })) },
      academicSession: { findFirst: async ({ where }: any) => Object.values(sessions).find(item => item.id === where.id && item.organizationId === where.organizationId) ?? null },
      branch: { findFirst: async ({ where }: any) => branches.find(item => item.id === where.id && item.organizationId === where.organizationId) ?? null },
      course: { findFirst: async ({ where }: any) => courses.find(item => item.id === where.id && item.organizationId === where.organizationId) ?? null },
      batch: { findFirst: async ({ where }: any) => batches.find(item => item.id === where.id && item.organizationId === where.organizationId) ?? null },
      feePlan: {
        create: async ({ data }: any) => { const row = { ...data, id: `plan-${++sequence}`, createdAt: new Date(), updatedAt: new Date() }; target.plans.push(row); return row; },
        findUnique: async ({ where }: any) => { const row = findPlan(where); return row ? materialize(target, row) : null; },
        findFirst: async ({ where }: any) => { const row = findPlan(where); return row ? materialize(target, row) : null; },
        findMany: async ({ where }: any) => target.plans.filter(row => matches(row, where)).map(row => materialize(target, row)),
        update: async ({ where, data }: any) => { const row = findPlan(where); if (!row) return null; Object.assign(row, data, { updatedAt: new Date() }); return row; },
        updateMany: async ({ where, data }: any) => { const rows = target.plans.filter(row => matches(row, where)); rows.forEach(row => Object.assign(row, data)); return { count: rows.length }; },
      },
      feePlanInstallment: {
        create: async ({ data }: any) => { const row = { ...data, id: `installment-${++sequence}`, createdAt: new Date(), updatedAt: new Date() }; target.installments.push(row); return row; },
        deleteMany: async ({ where }: any = {}) => { const before = target.installments.length; target.installments = target.installments.filter(row => !matches(row, where)); return { count: before - target.installments.length }; },
      },
      feePlanComponent: {
        create: async ({ data }: any) => { const row = { ...data, id: `component-${++sequence}`, createdAt: new Date(), updatedAt: new Date() }; target.components.push(row); return row; },
        deleteMany: async ({ where }: any = {}) => { const before = target.components.length; target.components = target.components.filter(row => !matches(row, where)); return { count: before - target.components.length }; },
      },
      auditLog: { create: async ({ data }: any) => { if (failAudit) throw new Error("Simulated AuditLog failure"); target.audits.push(data); return data; } },
    };
  };
  const patches: Array<() => void> = [];
  const patch = (target: any, key: string, replacement: any) => { const original = target[key]; target[key] = replacement; patches.unshift(() => { target[key] = original; }); };
  patch((systemPrisma as any).organization, "findUnique", async ({ where }: any) => organizations[where.id] ?? null);
  patch((systemPrisma as any).user, "findFirst", async ({ where }: any) => users.has(where.id) ? { isActive: true } : null);
  patch((systemPrisma as any).tenantAccessAudit, "create", async () => ({}));
  patch(prisma as any, "$transaction", async (work: any) => { const next = cloneState(); const result = await work(client(next)); commit(next); return result; });
  for (const key of ["branchUser", "academicSession", "branch", "course", "batch", "feePlan", "feePlanInstallment", "feePlanComponent", "auditLog"]) {
    const methods = key === "feePlan" ? ["findFirst", "findUnique", "findMany"] : key === "branchUser" ? ["findMany"] : key === "feePlanInstallment" || key === "feePlanComponent" ? ["deleteMany"] : [];
    for (const method of methods) patch((prisma as any)[key], method, (...args: any[]) => (client(state) as any)[key][method](...args));
  }
  const application = express(); application.use(express.json()); application.use("/api/v1", feePlans); application.use(errorHandler);
  const server = application.listen(0, "127.0.0.1");
  const ready = new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  async function request(path: string, method: string, requestBody?: unknown, auth: Partial<Auth> = {}) {
    activeAuth = { role: auth.role ?? Role.SUPER_ADMIN, userId: auth.userId ?? SUPER_ADMIN, organizationId: auth.organizationId ?? ORGANIZATION_A };
    const token = jwt.sign(activeAuth, env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
    await ready;
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: requestBody === undefined ? undefined : JSON.stringify(requestBody) });
    return { status: response.status, payload: await response.json() as any };
  }
  return { state, sessions, setFailAudit: (value: boolean) => { failAudit = value; }, request, close: () => { server.close(); patches.forEach(restore => restore()); } };
}

const body = (code: string, extra: Record<string, unknown> = {}) => ({ code, name: code, academicSessionId: "session-1", ...extra, installments: [{ sequence: 1, title: "First", dueDate: "2026-06-01", components: [{ feeHead: "Tuition", amountPaise: 12_500 }] }] });

test("fee-plan HTTP authorization, applicability and atomicity contracts", async () => {
  const h = makeHarness();
  try {
    const global = await h.request("/api/v1/finance/fee-plans", "POST", body("GLOBAL"));
    assert.equal(global.status, 201);
    const branchA = await h.request("/api/v1/finance/fee-plans", "POST", body("BRANCH-A", { branchId: BRANCH_A, courseId: "course-a", batchId: "batch-a" }));
    assert.equal(branchA.status, 201);
    const branchB = await h.request("/api/v1/finance/fee-plans", "POST", body("BRANCH-B", { branchId: BRANCH_B }));
    assert.equal(branchB.status, 201);
    const listed = await h.request("/api/v1/finance/fee-plans", "GET", undefined, { role: Role.SUPER_ADMIN });
    assert.equal(listed.status, 200); assert.equal(listed.payload.data.length, 3);
    const branchRead = await h.request("/api/v1/finance/fee-plans", "GET", undefined, { role: Role.BRANCH_ADMIN, userId: BRANCH_ADMIN });
    assert.equal(branchRead.status, 200); assert.equal(branchRead.payload.data.length, 2);
    const branchGlobalPatch = await h.request(`/api/v1/finance/fee-plans/${global.payload.data.id}`, "PATCH", { name: "blocked" }, { role: Role.BRANCH_ADMIN, userId: BRANCH_ADMIN });
    assert.equal(branchGlobalPatch.status, 403); assert.equal(branchGlobalPatch.payload.error.code, "BRANCH_FORBIDDEN");
    const branchGlobalTakeover = await h.request(`/api/v1/finance/fee-plans/${global.payload.data.id}`, "PATCH", { branchId: BRANCH_A, name: "Attempted takeover" }, { role: Role.BRANCH_ADMIN, userId: BRANCH_ADMIN });
    assert.equal(branchGlobalTakeover.status, 403); assert.equal(branchGlobalTakeover.payload.error.code, "BRANCH_FORBIDDEN");
    const storedGlobal = h.state.plans.find(plan => plan.id === global.payload.data.id);
    assert.deepEqual(
      { name: storedGlobal?.name, branchId: storedGlobal?.branchId, courseId: storedGlobal?.courseId, batchId: storedGlobal?.batchId },
      { name: "GLOBAL", branchId: null, courseId: null, batchId: null },
    );
    for (const [path, method, requestBody] of [[`/api/v1/finance/fee-plans/${global.payload.data.id}/activate`, "POST", {}], [`/api/v1/finance/fee-plans/${global.payload.data.id}/archive`, "POST", {}], [`/api/v1/finance/fee-plans/${global.payload.data.id}/new-version`, "POST", {}]] as const) {
      const response = await h.request(path, method, requestBody, { role: Role.BRANCH_ADMIN, userId: BRANCH_ADMIN });
      assert.equal(response.status, 403); assert.equal(response.payload.error.code, "BRANCH_FORBIDDEN");
    }
    const globalActivation = await h.request(`/api/v1/finance/fee-plans/${global.payload.data.id}/activate`, "POST", {});
    assert.equal(globalActivation.status, 200);
    const globalVersion = await h.request(`/api/v1/finance/fee-plans/${global.payload.data.id}/new-version`, "POST", {});
    assert.equal(globalVersion.status, 201); assert.equal(globalVersion.payload.data.version, 2);
    const globalCreate = await h.request("/api/v1/finance/fee-plans", "POST", body("BRANCH-GLOBAL"), { role: Role.BRANCH_ADMIN, userId: BRANCH_ADMIN });
    assert.equal(globalCreate.status, 403); assert.equal(globalCreate.payload.error.code, "BRANCH_FORBIDDEN");
    const branchBMutation = await h.request(`/api/v1/finance/fee-plans/${branchB.payload.data.id}`, "PATCH", { name: "blocked" }, { role: Role.BRANCH_ADMIN, userId: BRANCH_ADMIN });
    assert.equal(branchBMutation.status, 404); assert.equal(branchBMutation.payload.error.code, "FEE_PLAN_NOT_FOUND");
    for (const path of ["/archive", "/new-version"]) {
      const response = await h.request(`/api/v1/finance/fee-plans/${branchB.payload.data.id}${path}`, "POST", {}, { role: Role.BRANCH_ADMIN, userId: BRANCH_ADMIN });
      assert.equal(response.status, 403); assert.equal(response.payload.error.code, "BRANCH_FORBIDDEN");
    }
    const ownPatch = await h.request(`/api/v1/finance/fee-plans/${branchA.payload.data.id}`, "PATCH", { name: "Branch A updated", branchId: BRANCH_A }, { role: Role.BRANCH_ADMIN, userId: BRANCH_ADMIN });
    assert.equal(ownPatch.status, 200); assert.equal(ownPatch.payload.data.name, "Branch A updated"); assert.equal(ownPatch.payload.data.branchId, BRANCH_A);
    const ownVersion = await h.request(`/api/v1/finance/fee-plans/${branchA.payload.data.id}/new-version`, "POST", {}, { role: Role.BRANCH_ADMIN, userId: BRANCH_ADMIN });
    assert.equal(ownVersion.status, 201);
    const ownArchive = await h.request(`/api/v1/finance/fee-plans/${branchA.payload.data.id}/archive`, "POST", {}, { role: Role.BRANCH_ADMIN, userId: BRANCH_ADMIN });
    assert.equal(ownArchive.status, 200);
    const zeroRead = await h.request("/api/v1/finance/fee-plans", "GET", undefined, { role: Role.BRANCH_ADMIN, userId: ZERO_BRANCH_ADMIN });
    assert.equal(zeroRead.status, 200); assert.equal(zeroRead.payload.data.length, 0);
    const zeroMutation = await h.request(`/api/v1/finance/fee-plans/${branchA.payload.data.id}/archive`, "POST", {}, { role: Role.BRANCH_ADMIN, userId: ZERO_BRANCH_ADMIN });
    assert.equal(zeroMutation.status, 403); assert.equal(zeroMutation.payload.error.code, "BRANCH_FORBIDDEN");
    const accountantRead = await h.request("/api/v1/finance/fee-plans", "GET", undefined, { role: Role.ACCOUNTANT, userId: ACCOUNTANT });
    assert.equal(accountantRead.status, 200); assert.equal(accountantRead.payload.data.length, 4);
    for (const [path, method, requestBody] of [
      ["/api/v1/finance/fee-plans", "POST", body("ACCOUNTANT-CREATE")],
      [`/api/v1/finance/fee-plans/${branchA.payload.data.id}`, "PATCH", { name: "Accountant edit" }],
      [`/api/v1/finance/fee-plans/${branchA.payload.data.id}/activate`, "POST", {}],
      [`/api/v1/finance/fee-plans/${branchA.payload.data.id}/archive`, "POST", {}],
      [`/api/v1/finance/fee-plans/${branchA.payload.data.id}/new-version`, "POST", {}],
    ] as const) {
      const response = await h.request(path, method, requestBody, { role: Role.ACCOUNTANT, userId: ACCOUNTANT });
      assert.equal(response.status, 403); assert.equal(response.payload.error.code, "ACCOUNTANT_FINANCE_READ_ONLY");
    }
    const crossTenant = await h.request(`/api/v1/finance/fee-plans/${global.payload.data.id}`, "GET", undefined, { role: Role.SUPER_ADMIN, userId: OTHER_USER, organizationId: ORGANIZATION_B });
    assert.equal(crossTenant.status, 404); assert.equal(crossTenant.payload.error.code, "FEE_PLAN_NOT_FOUND");
  } finally { h.close(); }
});

test("fee-plan applicability and archived-session validation are enforced over HTTP", async () => {
  const h = makeHarness();
  try {
    for (const [code, extra, expected] of [
      ["COURSE-GLOBAL", { courseId: "course-a" }, "INVALID_COURSE"],
      ["COURSE-MISMATCH", { branchId: BRANCH_B, courseId: "course-a" }, "INVALID_COURSE"],
      ["BATCH-GLOBAL", { batchId: "batch-a" }, "INVALID_BATCH"],
      ["BATCH-BRANCH", { branchId: BRANCH_A, batchId: "batch-b" }, "INVALID_BATCH"],
      ["BATCH-SESSION", { branchId: BRANCH_A, batchId: "batch-old", academicSessionId: "session-1" }, "INVALID_BATCH"],
    ] as const) {
      const response = await h.request("/api/v1/finance/fee-plans", "POST", body(code, extra));
      assert.equal(response.status, 422); assert.equal(response.payload.error.code, expected);
    }
    const valid = await h.request("/api/v1/finance/fee-plans", "POST", body("VALID-COMBO", { branchId: BRANCH_A, courseId: "course-a", batchId: "batch-a" }));
    assert.equal(valid.status, 201);
    const archivedSource = await h.request("/api/v1/finance/fee-plans", "POST", body("ARCHIVE-SOURCE"));
    assert.equal(archivedSource.status, 201); h.sessions["session-1"].isArchived = true;
    const archivedVersion = await h.request(`/api/v1/finance/fee-plans/${archivedSource.payload.data.id}/new-version`, "POST", {});
    assert.equal(archivedVersion.status, 409); assert.equal(archivedVersion.payload.error.code, "ACADEMIC_SESSION_ARCHIVED");
  } finally { h.close(); }
});

test("fee-plan mutations roll back FeePlan, children and audit together", async () => {
  const h = makeHarness();
  try {
    h.setFailAudit(true);
    const failed = await h.request("/api/v1/finance/fee-plans", "POST", body("AUDIT-FAIL"));
    assert.equal(failed.status, 500);
    assert.equal(h.state.plans.length, 0); assert.equal(h.state.installments.length, 0); assert.equal(h.state.components.length, 0); assert.equal(h.state.audits.length, 0);
    h.setFailAudit(false);
    const succeeded = await h.request("/api/v1/finance/fee-plans", "POST", body("AUDIT-OK"));
    assert.equal(succeeded.status, 201); assert.equal(h.state.plans.length, 1); assert.equal(h.state.installments.length, 1); assert.equal(h.state.components.length, 1); assert.equal(h.state.audits.length, 1);
  } finally { h.close(); }
});
