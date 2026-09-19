import "express-async-errors";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Role, SubstitutionStatus } from "@prisma/client";
import express from "express";
import jwt from "jsonwebtoken";
import { env } from "../config.js";
import { errorHandler } from "../lib/http.js";
import { prisma, systemPrisma } from "../lib/prisma.js";
import operations from "./admin-academic-operations.js";

const ORGANIZATION_ID = "organization-substitution-finalize";
const USER_ID = "super-admin-substitution-finalize";
const BRANCH_ID = "cbranch000000000000000001";
const SUBSTITUTION_ID = "csubstitution0000000000001";

test("substitution finalization is conditional and audit-atomic", async t => {
  let status = SubstitutionStatus.ASSIGNED;
  let audits: string[] = [];
  let failAudit = false;
  let isolation: string | null = null;

  const full = () => ({
    id: SUBSTITUTION_ID,
    date: new Date("2026-09-20T00:00:00.000Z"),
    reason: "Coverage",
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
    timetable: { id: "ctimetable000000000000001", day: "MONDAY", periodNumber: 1, startMinute: 600, endMinute: 660 },
    originalTeacher: { id: "cteacher000000000000001", employeeNo: "T-1", user: { name: "Original" } },
    substituteTeacher: { id: "cteacher000000000000002", employeeNo: "T-2", user: { name: "Substitute" } },
    course: { id: "ccourse00000000000000001", title: "Course" },
    batch: { id: "cbatch000000000000000001", name: "Batch" },
    subject: { id: "csubject0000000000000001", name: "Subject" },
    approvedBy: { id: USER_ID, name: "Admin" },
  });

  const patches: Array<() => void> = [];
  function patch(target: any, property: string, replacement: (...args: any[]) => any) {
    const original = target[property];
    target[property] = replacement;
    patches.unshift(() => { target[property] = original; });
  }

  patch((systemPrisma as any).organization, "findUnique", async () => ({
    id: ORGANIZATION_ID, isActive: true, deletedAt: null, subscriptionStatus: "ACTIVE", trialEndsAt: null, subscriptionEndsAt: null,
  }));
  patch((systemPrisma as any).user, "findFirst", async () => ({ isActive: true }));
  patch((systemPrisma as any).tenantAccessAudit, "create", async () => ({}));
  patch((prisma as any).branch, "findUnique", async ({ where }: any) => where.id === BRANCH_ID ? { id: BRANCH_ID } : null);
  patch((prisma as any).teacherSubstitution, "findUnique", async ({ where }: any) => where.id === SUBSTITUTION_ID ? { id: SUBSTITUTION_ID, branchId: BRANCH_ID } : null);
  patch(prisma as any, "$transaction", async (operation: any, options: any) => {
    isolation = options?.isolationLevel ?? null;
    const beforeStatus = status;
    const beforeAudits = [...audits];
    const tx = {
      teacherSubstitution: {
        updateMany: async ({ where, data }: any) => {
          if (where.id !== SUBSTITUTION_ID || status !== where.status) return { count: 0 };
          status = data.status;
          return { count: 1 };
        },
        findUniqueOrThrow: async () => full(),
      },
      auditLog: {
        create: async ({ data }: any) => {
          if (failAudit) throw new Error("Simulated audit failure");
          audits.push(data.action);
          return data;
        },
      },
    };
    try {
      return await operation(tx);
    } catch (error) {
      status = beforeStatus;
      audits = beforeAudits;
      throw error;
    }
  });

  const application = express();
  application.use(express.json());
  application.use("/api/v1/admin", operations);
  application.use(errorHandler);
  const server = application.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const port = (server.address() as AddressInfo).port;
  const token = jwt.sign({ userId: USER_ID, role: Role.SUPER_ADMIN, organizationId: ORGANIZATION_ID }, env.JWT_ACCESS_SECRET, { expiresIn: "5m" });

  async function finalize(next: SubstitutionStatus) {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/admin/substitutions/${SUBSTITUTION_ID}/status`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    return { status: response.status, payload: await response.json() as any };
  }

  try {
    await t.test("first finalization succeeds with audit in a serializable transaction", async () => {
      status = SubstitutionStatus.ASSIGNED; audits = []; failAudit = false;
      const response = await finalize(SubstitutionStatus.COMPLETED);
      assert.equal(response.status, 200);
      assert.equal(status, SubstitutionStatus.COMPLETED);
      assert.deepEqual(audits, ["COMPLETE"]);
      assert.equal(isolation, "Serializable");
    });

    await t.test("a finalized substitution cannot be finalized again", async () => {
      const response = await finalize(SubstitutionStatus.CANCELLED);
      assert.equal(response.status, 409);
      assert.equal(response.payload.error.code, "SUBSTITUTION_FINALIZED");
      assert.equal(status, SubstitutionStatus.COMPLETED);
      assert.deepEqual(audits, ["COMPLETE"]);
    });

    await t.test("audit failure rolls back the status change", async () => {
      status = SubstitutionStatus.ASSIGNED; audits = []; failAudit = true;
      const response = await finalize(SubstitutionStatus.CANCELLED);
      assert.equal(response.status, 500);
      assert.equal(status, SubstitutionStatus.ASSIGNED);
      assert.deepEqual(audits, []);
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const restore of patches) restore();
  }
});
