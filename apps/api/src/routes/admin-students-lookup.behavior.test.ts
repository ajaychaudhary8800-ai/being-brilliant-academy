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

const ORG = "org-student-lookup-test";
const OTHER_ORG = "org-other-student-lookup-test";
const USER = "cuser00000000000000000001";
const BRANCH = "cbranch000000000000000001";
const OTHER_BRANCH = "cbranch000000000000000002";

test("finance student lookup reuses paginated authorized student search", async t => {
  let assignedBranches = [BRANCH];
  let requestOrganization = ORG;
  let capturedFind: any;
  const restore: Array<() => void> = [];
  const patch = (target: any, key: string, value: any) => { const previous = target[key]; target[key] = value; restore.unshift(() => { target[key] = previous; }); };
  t.after(() => restore.forEach(item => item()));

  patch((systemPrisma as any).organization, "findUnique", async () => ({ id: requestOrganization, isActive: true, deletedAt: null, subscriptionStatus: "ACTIVE", trialEndsAt: null, subscriptionEndsAt: null }));
  patch((systemPrisma as any).user, "findFirst", async () => ({ isActive: true }));
  patch((systemPrisma as any).tenantAccessAudit, "create", async () => ({}));
  const branches = async () => assignedBranches.map(branchId => ({ branchId }));
  patch((systemPrisma as any).branchUser, "findMany", branches);
  patch((prisma as any).branchUser, "findMany", branches);

  const student125 = {
    id: "cstudent000000000000125",
    admissionNo: "ADM-0125",
    fatherName: "Parent",
    className: "Class 10",
    academicSession: "2026-27",
    academicSessionId: "csession0000000000000001",
    user: { id: "cstudentuser000000000125", name: "Student 125", email: "student125@example.test", phone: null, avatarUrl: null, isActive: true },
    branch: { id: BRANCH, branchName: "Main" },
    batch: { id: "cbatch000000000000000001", name: "Batch A", code: "A", academicSession: "2026-27", academicSessionId: "csession0000000000000001", branch: { id: BRANCH, branchName: "Main" }, course: { id: "ccourse00000000000000001", title: "Science" } },
  };
  const available = (where: any) => requestOrganization === ORG && !(Array.isArray(where?.branchId?.in) && where.branchId.in.length === 0);
  const count = async ({ where }: any) => available(where) ? 1 : 0;
  const findMany = async (args: any) => { capturedFind = args; return available(args.where) ? [student125] : []; };
  patch((systemPrisma as any).studentProfile, "count", count);
  patch((systemPrisma as any).studentProfile, "findMany", findMany);
  patch((prisma as any).studentProfile, "count", count);
  patch((prisma as any).studentProfile, "findMany", findMany);
  patch((systemPrisma as any), "$transaction", async (operations: Promise<unknown>[]) => Promise.all(operations));
  patch((prisma as any), "$transaction", async (operations: Promise<unknown>[]) => Promise.all(operations));

  const app = express();
  app.use(express.json());
  app.use("/api/v1/admin", admin);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  t.after(() => server.close());
  const port = (server.address() as AddressInfo).port;
  const token = (role: Role, organizationId = ORG) => jwt.sign({ userId: USER, role, organizationId }, env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
  const get = async (role: Role, query: string, organizationId = ORG) => {
    requestOrganization = organizationId;
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/admin/students${query}`, { headers: { Authorization: `Bearer ${token(role, organizationId)}` } });
    return { status: response.status, payload: await response.json() as any };
  };

  const found = await get(Role.BRANCH_ADMIN, `?page=1&limit=20&status=active&search=Student%20125&branchId=${BRANCH}`);
  assert.equal(found.status, 200);
  assert.equal(found.payload.data[0].id, student125.id);
  assert.equal(found.payload.data[0].batch.course.id, student125.batch.course.id);
  assert.equal(found.payload.data[0].academicSessionId, student125.academicSessionId);
  assert.deepEqual(found.payload.meta, { total: 1, page: 1, limit: 20, totalPages: 1 });
  assert.equal(capturedFind.skip, 0);
  assert.equal(capturedFind.take, 20);
  assert.deepEqual(capturedFind.where.branchId, BRANCH);
  assert.equal(capturedFind.where.user.isActive, true);
  assert.equal(capturedFind.where.OR[2].user.name.contains, "Student 125");

  assert.equal((await get(Role.BRANCH_ADMIN, `?search=Student%20125&branchId=${OTHER_BRANCH}`)).status, 403);
  assert.equal((await get(Role.ACCOUNTANT, "?search=Student%20125")).status, 403);

  assignedBranches = [];
  const zeroBranch = await get(Role.BRANCH_ADMIN, "?search=Student%20125");
  assert.equal(zeroBranch.status, 200);
  assert.deepEqual(zeroBranch.payload.data, []);

  const crossTenant = await get(Role.SUPER_ADMIN, "?search=Student%20125", OTHER_ORG);
  assert.equal(crossTenant.status, 200);
  assert.deepEqual(crossTenant.payload.data, []);
});
