import "express-async-errors";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { ExaminationStatus, ExaminationType, Role } from "@prisma/client";
import express from "express";
import jwt from "jsonwebtoken";
import { env } from "../config.js";
import { errorHandler } from "../lib/http.js";
import { prisma, systemPrisma } from "../lib/prisma.js";
import examinations from "./admin-examinations.js";

const id = (suffix: string) => `cexa000000000000000000${suffix}`;
const ORGANIZATION = id("01"), BRANCH_A = id("02"), BRANCH_B = id("03"), USER = id("04");

function examination(branchId: string, suffix: string) {
  return {
    id: id(suffix), name: `Exam ${suffix}`, code: `EX-${suffix}`, type: ExaminationType.UNIT_TEST,
    academicSession: "2026-27", examDate: new Date("2026-09-15T00:00:00.000Z"), startMinute: 600, endMinute: 660,
    maximumMarks: 100, passingMarks: 40, status: ExaminationStatus.DRAFT, remarks: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"), updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    branch: { id: branchId, branchName: branchId === BRANCH_A ? "Branch A" : "Branch B", branchCode: branchId === BRANCH_A ? "A" : "B" },
    course: { id: id("10"), title: "Course", courseCode: "COURSE" },
    batch: { id: id("11"), name: "Batch", code: "BATCH" },
    subject: { id: id("12"), name: "Subject", code: "SUB" },
    teacher: { id: id("13"), employeeNo: "EMP-1", user: { name: "Teacher", email: "teacher@example.test" } },
    results: [], _count: { results: 0 },
  };
}

test("GET /admin/examinations enforces Branch Admin scope and preserves Super Admin filtering", async t => {
  let assignedBranches = [BRANCH_A];
  const records = [examination(BRANCH_A, "20"), examination(BRANCH_B, "21")];
  const patches: Array<() => void> = [];
  function patch(object: any, property: string, replacement: (...args: any[]) => any) {
    const original = object[property]; object[property] = replacement; patches.unshift(() => { object[property] = original; });
  }
  function matching(where: any) {
    if (typeof where?.branchId === "string") return records.filter(record => record.branch.id === where.branchId);
    if (Array.isArray(where?.branchId?.in)) return records.filter(record => where.branchId.in.includes(record.branch.id));
    return records;
  }

  patch((systemPrisma as any).organization, "findUnique", async () => ({ id: ORGANIZATION, isActive: true, deletedAt: null, subscriptionStatus: "ACTIVE", trialEndsAt: null, subscriptionEndsAt: null }));
  patch((systemPrisma as any).user, "findFirst", async () => ({ isActive: true }));
  patch((systemPrisma as any).tenantAccessAudit, "create", async () => ({}));
  patch((prisma as any).branchUser, "findMany", async () => assignedBranches.map(branchId => ({ branchId })));
  patch((prisma as any).examination, "count", async ({ where }: any) => matching(where).length);
  patch((prisma as any).examination, "findMany", async ({ where }: any) => matching(where));
  patch(prisma as any, "$transaction", async (operations: any) => Promise.all(operations));

  const application = express();
  application.use(express.json());
  application.use("/api/v1/admin", examinations);
  application.use(errorHandler);
  const server = application.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const port = (server.address() as AddressInfo).port;
  const token = (role: Role) => jwt.sign({ userId: USER, role, organizationId: ORGANIZATION }, env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
  async function request(role: Role, branchId?: string) {
    const query = branchId ? `?branchId=${branchId}` : "";
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/admin/examinations${query}`, { headers: { Authorization: `Bearer ${token(role)}` } });
    return { status: response.status, payload: await response.json() };
  }

  try {
    await t.test("Branch Admin without a filter receives only assigned-branch records", async () => {
      const response = await request(Role.BRANCH_ADMIN);
      assert.equal(response.status, 200);
      assert.deepEqual(response.payload.data.map((record: any) => record.branch.id), [BRANCH_A]);
    });

    await t.test("Branch Admin may request its assigned branch", async () => {
      const response = await request(Role.BRANCH_ADMIN, BRANCH_A);
      assert.equal(response.status, 200);
      assert.deepEqual(response.payload.data.map((record: any) => record.branch.id), [BRANCH_A]);
    });

    await t.test("Branch Admin cannot request an unassigned branch", async () => {
      const response = await request(Role.BRANCH_ADMIN, BRANCH_B);
      assert.equal(response.status, 403);
      assert.equal(response.payload.error.code, "BRANCH_FORBIDDEN");
    });

    await t.test("zero-branch Branch Admin receives no examination records", async () => {
      assignedBranches = [];
      const response = await request(Role.BRANCH_ADMIN);
      assert.equal(response.status, 200);
      assert.deepEqual(response.payload.data, []);
      assignedBranches = [BRANCH_A];
    });

    await t.test("Super Admin remains organization-wide and may filter by branch", async () => {
      const organizationWide = await request(Role.SUPER_ADMIN);
      assert.equal(organizationWide.status, 200);
      assert.deepEqual(organizationWide.payload.data.map((record: any) => record.branch.id), [BRANCH_A, BRANCH_B]);
      const filtered = await request(Role.SUPER_ADMIN, BRANCH_B);
      assert.equal(filtered.status, 200);
      assert.deepEqual(filtered.payload.data.map((record: any) => record.branch.id), [BRANCH_B]);
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const restore of patches) restore();
  }
});
