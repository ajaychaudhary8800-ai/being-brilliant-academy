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
import communication from "./communication.js";
import notices from "./notice-board.js";

const ORGANIZATION_ID = "organization-communication-attachment-test";
const STUDENT_USER_ID = "student-communication-attachment-test";
const BRANCH_A = "branch-communication-a";
const BRANCH_B = "branch-communication-b";
const BATCH_A = "batch-communication-a";
const BATCH_B = "batch-communication-b";
const ANNOUNCEMENT_ID = "clw9p8x7y0001abcd1234efgh";
const NOTICE_ID = "clw9p8x7y0002abcd1234efgh";
const attachmentBytes = Buffer.from("%PDF-1.7\nroute authorization attachment");

function matches(actual: unknown, expected: unknown): boolean {
  if (expected === null) return actual === null;
  if (expected && typeof expected === "object") {
    const condition = expected as Record<string, any>;
    if (Array.isArray(condition.OR)) return condition.OR.some(item => matches(actual, item));
    if (Array.isArray(condition.AND)) return condition.AND.every(item => matches(actual, item));
    if ("in" in condition) return condition.in.includes(actual);
    if ("lte" in condition) return actual instanceof Date && condition.lte instanceof Date ? actual <= condition.lte : false;
    if ("gte" in condition) return actual instanceof Date && condition.gte instanceof Date ? actual >= condition.gte : false;
    if ("not" in condition) return !matches(actual, condition.not);
    if ("equals" in condition) return actual === condition.equals;
    return Object.entries(condition).every(([key, value]) => matches((actual as any)?.[key], value));
  }
  return actual === expected;
}

function matchesWhere(record: Record<string, any>, where: Record<string, any>): boolean {
  return Object.entries(where).every(([key, expected]) => key === "OR"
    ? (expected as Record<string, any>[]).some(item => matchesWhere(record, item))
    : key === "AND"
      ? (expected as Record<string, any>[]).every(item => matchesWhere(record, item))
      : matches(record[key], expected));
}

test("communication attachment downloads enforce recipient and branch authorization", async t => {
  const announcement: Record<string, any> = {
    id: ANNOUNCEMENT_ID,
    kind: "ANNOUNCEMENT",
    audience: Role.STUDENT,
    branchId: BRANCH_A,
    batchId: BATCH_A,
    publishedAt: new Date(Date.now() - 60_000),
    scheduledAt: null,
    expiresAt: null,
    isArchived: false,
    deletedAt: null,
    attachmentName: "../internal/storage.pdf",
    attachmentMime: "application/pdf",
    attachmentData: attachmentBytes,
  };
  const notice: Record<string, any> = {
    id: NOTICE_ID,
    kind: "NOTICE",
    audience: Role.STUDENT,
    branchId: BRANCH_A,
    batchId: BATCH_A,
    publishedAt: new Date(Date.now() - 60_000),
    expiresAt: null,
    isArchived: false,
    deletedAt: null,
    attachmentName: "notice.pdf",
    attachmentMime: "application/pdf",
    attachmentData: attachmentBytes,
  };
  let currentUserId = STUDENT_USER_ID;
  let currentRole: Role = Role.STUDENT;
  let assignedBranches = [BRANCH_A];
  const records = new Map([[ANNOUNCEMENT_ID, announcement], [NOTICE_ID, notice]]);
  const patches: Array<() => void> = [];
  const patch = (target: any, property: string, replacement: (...args: any[]) => any) => {
    const original = target[property];
    target[property] = replacement;
    patches.unshift(() => { target[property] = original; });
  };
  patch((systemPrisma as any).user, "findFirst", async () => ({ isActive: true }));
  patch((systemPrisma as any).organization, "findUnique", async ({ where }: any) => ({ id: where.id, isActive: true, deletedAt: null, subscriptionStatus: "ACTIVE", trialEndsAt: null, subscriptionEndsAt: null }));
  patch((systemPrisma as any).tenantAccessAudit, "create", async () => ({}));
  patch((prisma as any).studentProfile, "findUnique", async () => ({ branchId: BRANCH_A, batchId: BATCH_A, status: "ACTIVE" }));
  patch((prisma as any).branchUser, "findMany", async () => assignedBranches.map(branchId => ({ branchId })));
  patch((prisma as any).announcement, "findFirst", async ({ where }: any) => {
    const record = records.get(where.id);
    return record && matchesWhere(record, where) ? record : null;
  });

  const application = express();
  application.use(communication);
  application.use(notices);
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
    await t.test("authorized announcement recipients receive bytes with safe document headers", async () => {
      currentRole = Role.STUDENT;
      currentUserId = STUDENT_USER_ID;
      const { response, body } = await request(`/communication/announcements/${ANNOUNCEMENT_ID}/attachment`);
      assert.equal(response.status, 200);
      assert.deepEqual(body, attachmentBytes);
      assert.equal(response.headers.get("content-type"), "application/pdf");
      assert.equal(response.headers.get("content-length"), String(attachmentBytes.length));
      const disposition = response.headers.get("content-disposition") ?? "";
      assert.match(disposition, /^attachment; filename="/);
      assert.doesNotMatch(disposition, /\.\.\//);
      assert.doesNotMatch(disposition, /internal[\\/]+storage/);
    });

    await t.test("announcement audience, branch and lifecycle constraints deny access", async () => {
      announcement.audience = Role.TEACHER;
      let result = await request(`/communication/announcements/${ANNOUNCEMENT_ID}/attachment`);
      assert.equal(result.response.status, 404);
      announcement.audience = Role.STUDENT;
      announcement.branchId = BRANCH_B;
      result = await request(`/communication/announcements/${ANNOUNCEMENT_ID}/attachment`);
      assert.equal(result.response.status, 404);
      announcement.branchId = BRANCH_A;
      announcement.isArchived = true;
      result = await request(`/communication/announcements/${ANNOUNCEMENT_ID}/attachment`);
      assert.equal(result.response.status, 404);
      announcement.isArchived = false;
      announcement.expiresAt = new Date(Date.now() - 60_000);
      result = await request(`/communication/announcements/${ANNOUNCEMENT_ID}/attachment`);
      assert.equal(result.response.status, 404);
      announcement.expiresAt = null;
    });

    await t.test("eligible notice recipients download only matching audience, branch and batch", async () => {
      const first = await request(`/notices/${NOTICE_ID}/attachment`);
      assert.equal(first.response.status, 200);
      assert.deepEqual(first.body, attachmentBytes);
      notice.batchId = BATCH_B;
      const denied = await request(`/notices/${NOTICE_ID}/attachment`);
      assert.equal(denied.response.status, 404);
      notice.batchId = BATCH_A;
      notice.audience = Role.TEACHER;
      const wrongAudience = await request(`/notices/${NOTICE_ID}/attachment`);
      assert.equal(wrongAudience.response.status, 404);
      notice.audience = Role.STUDENT;
    });

    await t.test("branch administrators cannot download an unassigned branch notice", async () => {
      currentRole = Role.BRANCH_ADMIN;
      currentUserId = "branch-admin-communication-attachment-test";
      assignedBranches = [BRANCH_B];
      const result = await request(`/notices/${NOTICE_ID}/attachment`);
      assert.equal(result.response.status, 404);
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const restore of patches) restore();
  }
});
