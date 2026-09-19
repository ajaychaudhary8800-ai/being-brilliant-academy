import "express-async-errors";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { FeePlanStatus, FeeStatus, Role } from "@prisma/client";
import express from "express";
import jwt from "jsonwebtoken";
import { env } from "../config.js";
import { errorHandler } from "../lib/http.js";
import { prisma, systemPrisma } from "../lib/prisma.js";
import feeAssignments from "./fee-assignments.js";

const ORG_A = "organization-assignment-a";
const ORG_B = "organization-assignment-b";
const SUPER = "user-assignment-super";
const BRANCH_ADMIN = "user-assignment-branch";
const ZERO_ADMIN = "user-assignment-zero";
const ACCOUNTANT = "user-assignment-accountant";
const OTHER_SUPER = "user-assignment-other";
const BRANCH_A = "branch-assignment-a";
const BRANCH_B = "branch-assignment-b";
const BATCH_A = "batch-assignment-a";
const BATCH_A2 = "batch-assignment-a2";
const BATCH_B = "batch-assignment-b";
const BATCH_OLD = "batch-assignment-old";

type Auth = { role: Role; userId: string; organizationId: string };
type State = { assignments: any[]; fees: any[]; audits: any[] };

const installments = (prefix: string) => [
  { id: `${prefix}-inst-1`, organizationId: ORG_A, sequence: 1, dueDate: new Date("2026-06-01"), components: [
    { id: `${prefix}-component-tuition`, organizationId: ORG_A, feeHead: "Tuition", amountPaise: 10_000, position: 0 },
    { id: `${prefix}-component-lab`, organizationId: ORG_A, feeHead: "Laboratory", amountPaise: 2_500, position: 1 },
  ] },
  { id: `${prefix}-inst-2`, organizationId: ORG_A, sequence: 2, dueDate: new Date("2026-09-01"), components: [
    { id: `${prefix}-component-exam`, organizationId: ORG_A, feeHead: "Examination", amountPaise: 3_000, position: 0 },
  ] },
];

function makeHarness() {
  const sessions = [
    { id: "session-1", organizationId: ORG_A, name: "2026-27" },
    { id: "session-2", organizationId: ORG_A, name: "2025-26" },
    { id: "session-b", organizationId: ORG_B, name: "2026-27" },
  ];
  const branches = [
    { id: BRANCH_A, organizationId: ORG_A, branchCode: "A", branchName: "Branch A" },
    { id: BRANCH_B, organizationId: ORG_A, branchCode: "B", branchName: "Branch B" },
    { id: "branch-other", organizationId: ORG_B, branchCode: "O", branchName: "Other" },
  ];
  const batches = [
    { id: BATCH_A, organizationId: ORG_A, branchId: BRANCH_A, courseId: "course-a", academicSessionId: "session-1", code: "A1", name: "Batch A" },
    { id: BATCH_A2, organizationId: ORG_A, branchId: BRANCH_A, courseId: "course-a", academicSessionId: "session-1", code: "A2", name: "Batch A2" },
    { id: BATCH_B, organizationId: ORG_A, branchId: BRANCH_B, courseId: "course-b", academicSessionId: "session-1", code: "B1", name: "Batch B" },
    { id: BATCH_OLD, organizationId: ORG_A, branchId: BRANCH_A, courseId: "course-a", academicSessionId: "session-2", code: "OLD", name: "Old Batch" },
    { id: "batch-other", organizationId: ORG_B, branchId: "branch-other", courseId: "course-other", academicSessionId: "session-b", code: "O1", name: "Other Batch" },
  ];
  const students = [
    { id: "student-a", organizationId: ORG_A, branchId: BRANCH_A, batchId: BATCH_A, academicSessionId: "session-1" },
    { id: "student-a2", organizationId: ORG_A, branchId: BRANCH_A, batchId: BATCH_A2, academicSessionId: "session-1" },
    { id: "student-b", organizationId: ORG_A, branchId: BRANCH_B, batchId: BATCH_B, academicSessionId: "session-1" },
    { id: "student-old", organizationId: ORG_A, branchId: BRANCH_A, batchId: BATCH_OLD, academicSessionId: "session-2" },
    { id: "student-other", organizationId: ORG_B, branchId: "branch-other", batchId: "batch-other", academicSessionId: "session-b" },
  ];
  const plan = (id: string, status: FeePlanStatus, extra: Record<string, unknown> = {}) => ({ id, organizationId: ORG_A, familyKey: `family-${id}`, code: id.toUpperCase(), name: id, version: 1, status, academicSessionId: "session-1", branchId: null, courseId: null, batchId: null, installments: installments(id), ...extra });
  const plans = [
    plan("global-active", FeePlanStatus.ACTIVE),
    plan("branch-active", FeePlanStatus.ACTIVE, { branchId: BRANCH_A }),
    plan("combo-active", FeePlanStatus.ACTIVE, { branchId: BRANCH_A, courseId: "course-a", batchId: BATCH_A }),
    plan("draft-plan", FeePlanStatus.DRAFT),
    plan("inactive-plan", FeePlanStatus.INACTIVE),
    plan("archived-plan", FeePlanStatus.ARCHIVED),
    plan("wrong-session", FeePlanStatus.ACTIVE, { academicSessionId: "session-2" }),
    plan("wrong-branch", FeePlanStatus.ACTIVE, { branchId: BRANCH_B }),
    plan("wrong-course", FeePlanStatus.ACTIVE, { courseId: "course-b" }),
    plan("wrong-batch", FeePlanStatus.ACTIVE, { batchId: BATCH_A2 }),
    plan("global-v2", FeePlanStatus.ACTIVE, { familyKey: "family-global-active", version: 2 }),
    { ...plan("other-plan", FeePlanStatus.ACTIVE), organizationId: ORG_B, academicSessionId: "session-b", installments: installments("other").map(item => ({ ...item, organizationId: ORG_B, components: item.components.map(component => ({ ...component, organizationId: ORG_B })) })) },
  ];
  const legacyFee = { id: "legacy-fee", organizationId: ORG_A, studentId: "student-a", branchId: BRANCH_A, courseId: "course-a", batchId: BATCH_A, feeHead: "Legacy", totalPaise: 999, dueDate: new Date("2026-05-01"), status: FeeStatus.PENDING, studentFeeAssignmentId: null, feePlanComponentId: null };
  const state: State = { assignments: [], fees: [legacyFee], audits: [] };
  let sequence = 0;
  let activeAuth: Auth = { role: Role.SUPER_ADMIN, userId: SUPER, organizationId: ORG_A };
  let failFeeAt = 0;
  let failAudit = false;
  const organizations = new Set([ORG_A, ORG_B]);
  const users = new Set([SUPER, BRANCH_ADMIN, ZERO_ADMIN, ACCOUNTANT, OTHER_SUPER]);
  const branchAssignments: Record<string, string[]> = { [BRANCH_ADMIN]: [BRANCH_A], [ACCOUNTANT]: [BRANCH_A], [ZERO_ADMIN]: [] };
  const clone = <T>(value: T): T => structuredClone(value);
  const matches = (row: any, where: any): boolean => {
    if (!row) return false;
    for (const [key, expected] of Object.entries(where ?? {})) {
      if (expected && typeof expected === "object" && "in" in expected) { if (!(expected as any).in.includes(row[key])) return false; }
      else if (row[key] !== expected) return false;
    }
    return true;
  };
  const studentMaterialized = (row: any) => ({ ...clone(row), batch: clone(batches.find(batch => batch.id === row.batchId)) });
  const assignmentMaterialized = (target: State, row: any) => ({
    ...clone(row),
    feePlan: clone(plans.find(item => item.id === row.feePlanId)),
    academicSession: clone(sessions.find(item => item.id === row.academicSessionId)),
    branch: clone(branches.find(item => item.id === row.branchId)),
    batch: clone(batches.find(item => item.id === row.batchId)),
    assignedBy: { id: row.assignedById, name: row.assignedById },
    fees: clone(target.fees.filter(fee => fee.studentFeeAssignmentId === row.id).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.id.localeCompare(b.id))),
  });
  const client = (target: State) => {
    let feeCreates = 0;
    return {
      branchUser: { findMany: async () => (branchAssignments[activeAuth.userId] ?? []).map(branchId => ({ branchId })) },
      studentProfile: { findFirst: async ({ where }: any) => { const row = students.find(item => matches(item, where)); return row ? studentMaterialized(row) : null; } },
      feePlan: { findFirst: async ({ where }: any) => { const row = plans.find(item => matches(item, where)); return row ? clone(row) : null; } },
      studentFeeAssignment: {
        create: async ({ data }: any) => { const row = { ...clone(data), id: `assignment-${++sequence}`, assignedAt: new Date() }; target.assignments.push(row); return clone(row); },
        findFirst: async ({ where }: any) => { const row = target.assignments.find(item => matches(item, where)); return row ? assignmentMaterialized(target, row) : null; },
        findUnique: async ({ where }: any) => { const row = target.assignments.find(item => matches(item, where)); return row ? assignmentMaterialized(target, row) : null; },
        findMany: async ({ where }: any) => target.assignments.filter(item => matches(item, where)).map(item => assignmentMaterialized(target, item)),
      },
      fee: { create: async ({ data }: any) => { if (failFeeAt && ++feeCreates === failFeeAt) throw new Error("Simulated Fee create failure"); const row = { discountPaise: 0, finePaise: 0, amountPaidPaise: 0, ...clone(data), id: `fee-${++sequence}`, createdAt: new Date(), updatedAt: new Date() }; target.fees.push(row); return clone(row); } },
      auditLog: { create: async ({ data }: any) => { if (failAudit) throw new Error("Simulated AuditLog failure"); target.audits.push(clone(data)); return clone(data); } },
    };
  };
  const patches: Array<() => void> = [];
  const patchMethod = (target: any, key: string, replacement: any) => { const original = target[key]; target[key] = replacement; patches.unshift(() => { target[key] = original; }); };
  patchMethod((systemPrisma as any).organization, "findUnique", async ({ where }: any) => organizations.has(where.id) ? { id: where.id, isActive: true, deletedAt: null, subscriptionStatus: "ACTIVE", trialEndsAt: null, subscriptionEndsAt: null } : null);
  patchMethod((systemPrisma as any).user, "findFirst", async ({ where }: any) => users.has(where.id) ? { isActive: true } : null);
  patchMethod((systemPrisma as any).tenantAccessAudit, "create", async () => ({}));
  patchMethod(prisma as any, "$transaction", async (work: any) => { const next = clone(state); const result = await work(client(next)); state.assignments = next.assignments; state.fees = next.fees; state.audits = next.audits; return result; });
  for (const [model, methods] of [["branchUser", ["findMany"]], ["studentFeeAssignment", ["findFirst", "findUnique", "findMany"]]] as const) {
    for (const method of methods) patchMethod((prisma as any)[model], method, (...args: any[]) => (client(state) as any)[model][method](...args));
  }
  const application = express(); application.use(express.json()); application.use("/api/v1", feeAssignments); application.use(errorHandler);
  const server = application.listen(0, "127.0.0.1");
  const ready = new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  async function request(path: string, method: string, requestBody?: unknown, auth: Partial<Auth> = {}) {
    activeAuth = { role: auth.role ?? Role.SUPER_ADMIN, userId: auth.userId ?? SUPER, organizationId: auth.organizationId ?? ORG_A };
    const token = jwt.sign(activeAuth, env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
    await ready;
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: requestBody === undefined ? undefined : JSON.stringify(requestBody) });
    return { status: response.status, payload: await response.json() as any };
  }
  return { state, request, setFailFeeAt: (value: number) => { failFeeAt = value; }, setFailAudit: (value: boolean) => { failAudit = value; }, close: () => { server.close(); patches.forEach(restore => restore()); } };
}

test("assignment generates authoritative Fee snapshots and exact repeats are idempotent", async () => {
  const h = makeHarness();
  try {
    const rejectedOverride = await h.request("/api/v1/finance/fee-assignments", "POST", { studentId: "student-a", feePlanId: "global-active", totalPaise: 1 });
    assert.equal(rejectedOverride.status, 422); assert.equal(h.state.assignments.length, 0);
    const first = await h.request("/api/v1/finance/fee-assignments", "POST", { studentId: "student-a", feePlanId: "global-active" });
    assert.equal(first.status, 201); assert.equal(first.payload.created, true); assert.equal(first.payload.data.generatedFeeCount, 3); assert.equal(first.payload.data.generatedTotalPaise, 15_500);
    assert.deepEqual(first.payload.data.generatedFees.map((fee: any) => [fee.feeHead, fee.totalPaise, fee.dueDate.slice(0, 10)]), [["Tuition", 10_000, "2026-06-01"], ["Laboratory", 2_500, "2026-06-01"], ["Examination", 3_000, "2026-09-01"]]);
    assert.ok(first.payload.data.generatedFees.every((fee: any) => fee.studentId === "student-a" && fee.branchId === BRANCH_A && fee.batchId === BATCH_A && fee.courseId === "course-a" && fee.studentFeeAssignmentId === first.payload.data.id && fee.feePlanComponentId));
    const before = { assignments: h.state.assignments.length, fees: h.state.fees.length, audits: h.state.audits.length };
    const repeat = await h.request("/api/v1/finance/fee-assignments", "POST", { studentId: "student-a", feePlanId: "global-active" });
    assert.equal(repeat.status, 200); assert.equal(repeat.payload.created, false); assert.deepEqual({ assignments: h.state.assignments.length, fees: h.state.fees.length, audits: h.state.audits.length }, before);
    const otherVersion = await h.request("/api/v1/finance/fee-assignments", "POST", { studentId: "student-a", feePlanId: "global-v2" });
    assert.equal(otherVersion.status, 409); assert.equal(otherVersion.payload.error.code, "FEE_ASSIGNMENT_FAMILY_EXISTS");
    for (const feePlanId of ["draft-plan", "inactive-plan", "archived-plan"]) {
      const response = await h.request("/api/v1/finance/fee-assignments", "POST", { studentId: "student-a2", feePlanId });
      assert.equal(response.status, 409); assert.equal(response.payload.error.code, "FEE_PLAN_NOT_ACTIVE");
    }
    assert.equal(h.state.fees.find(fee => fee.id === "legacy-fee")?.studentFeeAssignmentId, null);
    assert.equal(h.state.fees.find(fee => fee.id === "legacy-fee")?.feePlanComponentId, null);
    h.state.fees = h.state.fees.filter(fee => fee.feePlanComponentId !== "global-active-component-exam");
    const incomplete = await h.request("/api/v1/finance/fee-assignments", "POST", { studentId: "student-a", feePlanId: "global-active" });
    assert.equal(incomplete.status, 409); assert.equal(incomplete.payload.error.code, "FEE_ASSIGNMENT_INCOMPLETE");
  } finally { h.close(); }
});

test("assignment authorization and reads are tenant and branch scoped", async () => {
  const h = makeHarness();
  try {
    const global = await h.request("/api/v1/finance/fee-assignments", "POST", { studentId: "student-a", feePlanId: "global-active" }, { role: Role.BRANCH_ADMIN, userId: BRANCH_ADMIN });
    assert.equal(global.status, 201);
    const branch = await h.request("/api/v1/finance/fee-assignments", "POST", { studentId: "student-a2", feePlanId: "branch-active" }, { role: Role.BRANCH_ADMIN, userId: BRANCH_ADMIN });
    assert.equal(branch.status, 201);
    const unassigned = await h.request("/api/v1/finance/fee-assignments", "POST", { studentId: "student-b", feePlanId: "global-active" }, { role: Role.BRANCH_ADMIN, userId: BRANCH_ADMIN });
    assert.equal(unassigned.status, 403); assert.equal(unassigned.payload.error.code, "BRANCH_FORBIDDEN");
    const zero = await h.request("/api/v1/finance/fee-assignments", "POST", { studentId: "student-a", feePlanId: "global-active" }, { role: Role.BRANCH_ADMIN, userId: ZERO_ADMIN });
    assert.equal(zero.status, 403); assert.equal(zero.payload.error.code, "BRANCH_FORBIDDEN");
    const accountantRead = await h.request("/api/v1/finance/fee-assignments", "GET", undefined, { role: Role.ACCOUNTANT, userId: ACCOUNTANT });
    assert.equal(accountantRead.status, 200); assert.equal(accountantRead.payload.data.length, 2);
    const accountantPost = await h.request("/api/v1/finance/fee-assignments", "POST", { studentId: "student-a", feePlanId: "global-active" }, { role: Role.ACCOUNTANT, userId: ACCOUNTANT });
    assert.equal(accountantPost.status, 403); assert.equal(accountantPost.payload.error.code, "ACCOUNTANT_FINANCE_READ_ONLY");
    const other = await h.request("/api/v1/finance/fee-assignments", "POST", { studentId: "student-other", feePlanId: "other-plan" }, { role: Role.SUPER_ADMIN, userId: OTHER_SUPER, organizationId: ORG_B });
    assert.equal(other.status, 201);
    for (const body of [{ studentId: "student-other", feePlanId: "global-active" }, { studentId: "student-a", feePlanId: "other-plan" }]) {
      const response = await h.request("/api/v1/finance/fee-assignments", "POST", body);
      assert.equal(response.status, 404);
    }
    const crossTenantGet = await h.request(`/api/v1/finance/fee-assignments/${other.payload.data.id}`, "GET");
    assert.equal(crossTenantGet.status, 404); assert.equal(crossTenantGet.payload.error.code, "FEE_ASSIGNMENT_NOT_FOUND");
  } finally { h.close(); }
});

test("assignment applicability follows canonical StudentProfile and Batch scope", async () => {
  const h = makeHarness();
  try {
    for (const [feePlanId, code] of [["wrong-session", "FEE_PLAN_SESSION_MISMATCH"], ["wrong-branch", "FEE_PLAN_BRANCH_MISMATCH"], ["wrong-course", "FEE_PLAN_COURSE_MISMATCH"], ["wrong-batch", "FEE_PLAN_BATCH_MISMATCH"]] as const) {
      const response = await h.request("/api/v1/finance/fee-assignments", "POST", { studentId: "student-a", feePlanId });
      assert.equal(response.status, 422); assert.equal(response.payload.error.code, code);
    }
    const valid = await h.request("/api/v1/finance/fee-assignments", "POST", { studentId: "student-a", feePlanId: "combo-active" });
    assert.equal(valid.status, 201); assert.equal(valid.payload.data.academicSessionId, "session-1"); assert.equal(valid.payload.data.branchId, BRANCH_A); assert.equal(valid.payload.data.batchId, BATCH_A);
  } finally { h.close(); }
});

test("Fee and audit failures roll back assignment generation atomically", async () => {
  const h = makeHarness();
  try {
    h.setFailFeeAt(2);
    const feeFailure = await h.request("/api/v1/finance/fee-assignments", "POST", { studentId: "student-a", feePlanId: "global-active" });
    assert.equal(feeFailure.status, 500); assert.equal(h.state.assignments.length, 0); assert.equal(h.state.fees.length, 1); assert.equal(h.state.audits.length, 0);
    h.setFailFeeAt(0); h.setFailAudit(true);
    const auditFailure = await h.request("/api/v1/finance/fee-assignments", "POST", { studentId: "student-a", feePlanId: "global-active" });
    assert.equal(auditFailure.status, 500); assert.equal(h.state.assignments.length, 0); assert.equal(h.state.fees.length, 1); assert.equal(h.state.audits.length, 0);
  } finally { h.close(); }
});
