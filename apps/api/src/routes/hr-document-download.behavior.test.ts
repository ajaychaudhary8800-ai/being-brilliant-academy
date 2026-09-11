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
import hr from "./hr-payroll.js";

const ORGANIZATION_ID = "organization-hr-document-download-test";
const EMPLOYEE_A = "employee-hr-document-a";
const EMPLOYEE_B = "employee-hr-document-b";
const USER_A = "user-hr-document-a";
const USER_B = "user-hr-document-b";
const BRANCH_A = "branch-hr-document-a";
const BRANCH_B = "branch-hr-document-b";
const DOCUMENT_A = "document-hr-download-a";
const DOCUMENT_B = "document-hr-download-b";
const TAX_A = "tax-hr-download-a";
const TAX_B = "tax-hr-download-b";
const bytes = Buffer.from("%PDF-1.7\nHR document bytes");

test("HR document downloads enforce employee ownership and administrative branch scope", async t => {
  const employeeDocuments = new Map([
    [DOCUMENT_A, { id: DOCUMENT_A, name: "..\\internal\r\n-document.pdf", mimeType: "application/pdf", data: bytes, employee: { userId: USER_A, branchId: BRANCH_A } }],
    [DOCUMENT_B, { id: DOCUMENT_B, name: "branch-b.pdf", mimeType: "application/pdf", data: bytes, employee: { userId: USER_B, branchId: BRANCH_B } }],
  ]);
  const taxDocuments = new Map([
    [TAX_A, { id: TAX_A, name: "tax-a.pdf", mimeType: "application/pdf", data: bytes, employee: { userId: USER_A, branchId: BRANCH_A } }],
    [TAX_B, { id: TAX_B, name: "tax-b.pdf", mimeType: "application/pdf", data: bytes, employee: { userId: USER_B, branchId: BRANCH_B } }],
  ]);
  let currentUserId = USER_A;
  let currentRole: Role = Role.EMPLOYEE;
  let assignedBranches = [BRANCH_A];
  let branchQueries = 0;
  const patches: Array<() => void> = [];
  const patch = (target: any, property: string, replacement: (...args: any[]) => any) => {
    const original = target[property];
    target[property] = replacement;
    patches.unshift(() => { target[property] = original; });
  };
  patch((systemPrisma as any).user, "findFirst", async () => ({ isActive: true }));
  patch((systemPrisma as any).organization, "findUnique", async () => ({ id: ORGANIZATION_ID, isActive: true, deletedAt: null, subscriptionStatus: "ACTIVE", trialEndsAt: null, subscriptionEndsAt: null }));
  patch((systemPrisma as any).tenantAccessAudit, "create", async () => ({}));
  patch((prisma as any).branchUser, "findMany", async () => { branchQueries += 1; return assignedBranches.map(branchId => ({ branchId })); });
  patch((prisma as any).employeeDocument, "findUnique", async ({ where }: any) => employeeDocuments.get(where.id) ?? null);
  patch((prisma as any).taxDocument, "findUnique", async ({ where }: any) => taxDocuments.get(where.id) ?? null);

  const application = express();
  application.use(hr);
  application.use(errorHandler);
  const server = application.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const port = (server.address() as AddressInfo).port;
  const token = () => jwt.sign({ userId: currentUserId, role: currentRole, organizationId: ORGANIZATION_ID }, env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
  const request = async (path: string) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { Authorization: `Bearer ${token()}` } });
    return { response, body: response.status === 200 ? Buffer.from(await response.arrayBuffer()) : await response.json() as any };
  };

  try {
    await t.test("employee owners can download without the admin guard", async () => {
      currentRole = Role.EMPLOYEE;
      currentUserId = USER_A;
      branchQueries = 0;
      const result = await request(`/hr/documents/${DOCUMENT_A}/download`);
      assert.equal(result.response.status, 200);
      assert.deepEqual(result.body, bytes);
      assert.equal(result.response.headers.get("content-type"), "application/pdf");
      assert.equal(result.response.headers.get("content-length"), String(bytes.length));
      const disposition = result.response.headers.get("content-disposition") ?? "";
      assert.match(disposition, /^attachment; filename="/);
      assert.doesNotMatch(disposition, /[\r\n\0]/);
      assert.doesNotMatch(disposition, /\.\.\\|internal[\\/]storage/);
      assert.equal(branchQueries, 0);
    });

    await t.test("different employees cannot download employee documents", async () => {
      currentRole = Role.EMPLOYEE;
      currentUserId = USER_B;
      const result = await request(`/hr/documents/${DOCUMENT_A}/download`);
      assert.equal(result.response.status, 403);
    });

    await t.test("assigned Branch Admins can download while unassigned branches are denied", async () => {
      currentRole = Role.BRANCH_ADMIN;
      currentUserId = "branch-admin-hr-document";
      assignedBranches = [BRANCH_A];
      let result = await request(`/hr/documents/${DOCUMENT_A}/download`);
      assert.equal(result.response.status, 200);
      assert.deepEqual(result.body, bytes);
      assignedBranches = [BRANCH_B];
      result = await request(`/hr/documents/${DOCUMENT_A}/download`);
      assert.equal(result.response.status, 403);
    });

    await t.test("tax documents follow the same ownership and branch rules", async () => {
      currentRole = Role.EMPLOYEE;
      currentUserId = USER_A;
      let result = await request(`/hr/tax-documents/${TAX_A}/download`);
      assert.equal(result.response.status, 200);
      assert.deepEqual(result.body, bytes);
      assert.equal(result.response.headers.get("content-type"), "application/pdf");
      assert.equal(result.response.headers.get("content-length"), String(bytes.length));
      assert.match(result.response.headers.get("content-disposition") ?? "", /^attachment; filename="tax-a\.pdf"$/);
      currentUserId = USER_B;
      result = await request(`/hr/tax-documents/${TAX_A}/download`);
      assert.equal(result.response.status, 403);
      currentRole = Role.BRANCH_ADMIN;
      assignedBranches = [BRANCH_A];
      result = await request(`/hr/tax-documents/${TAX_A}/download`);
      assert.equal(result.response.status, 200);
      assignedBranches = [BRANCH_B];
      result = await request(`/hr/tax-documents/${TAX_A}/download`);
      assert.equal(result.response.status, 403);
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const restore of patches) restore();
  }
});
