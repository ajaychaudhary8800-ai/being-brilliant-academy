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
import adminFees from "./admin-fees.js";

const ORG = "org-fee-read-test";
const OTHER_ORG = "org-other-fee-read-test";
const USER = "cuser00000000000000000001";
const BRANCH = "cbranch000000000000000001";
const OTHER_BRANCH = "cbranch000000000000000002";

test("paginated payment history preserves finance read scope and institution dates", async t => {
  let assignedBranches = [BRANCH];
  let requestOrganization = ORG;
  let capturedFind: any;
  let capturedAggregate: any;
  const restore: Array<() => void> = [];
  const patch = (target: any, key: string, value: any) => { const previous = target[key]; target[key] = value; restore.unshift(() => { target[key] = previous; }); };
  t.after(() => restore.forEach(item => item()));

  const organization = async ({ select }: any = {}) => select?.timezone
    ? { timezone: "Asia/Kolkata" }
    : { id: requestOrganization, isActive: true, deletedAt: null, subscriptionStatus: "ACTIVE", trialEndsAt: null, subscriptionEndsAt: null };
  patch((systemPrisma as any).organization, "findUnique", organization);
  patch((prisma as any).organization, "findUnique", organization);
  patch((systemPrisma as any).user, "findFirst", async () => ({ isActive: true }));
  patch((systemPrisma as any).tenantAccessAudit, "create", async () => ({}));
  const branches = async () => assignedBranches.map(branchId => ({ branchId }));
  patch((systemPrisma as any).branchUser, "findMany", branches);
  patch((prisma as any).branchUser, "findMany", branches);

  const available = (where: any) => requestOrganization === ORG && !(Array.isArray(where?.fee?.branchId?.in) && where.fee.branchId.in.length === 0);
  const row = { id: "cpayment00000000000000001", amountPaise: 10_000, paymentDate: new Date("2026-09-13T00:00:00.000Z"), paymentMode: "UPI", transactionId: "txn-1", receiptNumber: "receipt-1", remarks: null, collectedById: USER, createdAt: new Date("2026-09-13T00:00:00.000Z"), offsets: [{ id: "offset-1", type: "REFUND", amountPaise: 1_000, reason: "Return", reference: null, createdAt: new Date("2026-09-13T01:00:00.000Z"), createdBy: { id: USER, name: "Finance User", email: "finance@example.test" } }], fee: { id: "cfee000000000000000001", feeHead: "Tuition", branchId: BRANCH, student: { id: "cstudent000000000000001", admissionNo: "A-1", user: { id: USER, name: "Student One", email: "student@example.test" } }, branch: { id: BRANCH, branchName: "Main", branchCode: "MAIN" } } };
  const secondRow = { ...row, id: "cpayment00000000000000002", transactionId: "txn-2", receiptNumber: "receipt-2", offsets: [] };
  const searchedRows = (where: any) => {
    if (!available(where)) return [];
    const rows = [row, secondRow], clauses = where?.OR ?? [], search = clauses.find((clause: any) => clause.receiptNumber)?.receiptNumber?.contains;
    const direct = search ? rows.filter(item => item.receiptNumber.includes(search) || item.transactionId?.includes(search)) : [];
    if (direct.length) return direct;
    const related = clauses.some((clause: any) => clause.fee?.feeHead || clause.fee?.student?.admissionNo || clause.fee?.student?.user?.name);
    return related ? rows : [row];
  };
  const count = async ({ where }: any) => where?.OR ? searchedRows(where).length : available(where) ? 45 : 0;
  const findMany = async (args: any) => { capturedFind = args; return args.where?.OR ? searchedRows(args.where) : available(args.where) ? [row] : []; };
  patch((systemPrisma as any).feePayment, "count", count);
  patch((systemPrisma as any).feePayment, "findMany", findMany);
  patch((prisma as any).feePayment, "count", count);
  patch((prisma as any).feePayment, "findMany", findMany);
  const aggregate = async (args: any) => { capturedAggregate = args; return { _sum: { amountPaise: available(args.where) ? 10_000 : null } }; };
  patch((systemPrisma as any).feePayment, "aggregate", aggregate);
  patch((prisma as any).feePayment, "aggregate", aggregate);
  patch((systemPrisma as any).feePaymentOffset, "groupBy", async () => []);
  patch((prisma as any).feePaymentOffset, "groupBy", async () => []);
  patch((systemPrisma as any), "$transaction", async (operations: Promise<unknown>[]) => Promise.all(operations));
  patch((prisma as any), "$transaction", async (operations: Promise<unknown>[]) => Promise.all(operations));

  const app = express();
  app.use(express.json());
  app.use("/api/v1/admin", adminFees);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  t.after(() => server.close());
  const port = (server.address() as AddressInfo).port;
  const token = (role: Role, organizationId = ORG) => jwt.sign({ userId: USER, role, organizationId }, env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
  const get = async (role: Role, query = "", organizationId = ORG, targetOrganization?: string) => {
    requestOrganization = organizationId;
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/admin/fees/payments${query}`, { headers: { Authorization: `Bearer ${token(role, organizationId)}`, ...(targetOrganization ? { "x-organization-id": targetOrganization } : {}) } });
    return { status: response.status, payload: await response.json() as any };
  };

  await t.test("Super Admin can filter and receives pagination plus immutable offsets", async () => {
    const response = await get(Role.SUPER_ADMIN, `?page=2&limit=20&branchId=${BRANCH}&from=2026-09-13&to=2026-09-13`);
    assert.equal(response.status, 200);
    assert.deepEqual(response.payload.meta, { total: 45, page: 2, limit: 20, totalPages: 3 });
    assert.equal(response.payload.data[0].offsets[0].type, "REFUND");
    assert.equal(capturedFind.skip, 20);
    assert.equal(capturedFind.take, 20);
    assert.equal(capturedFind.where.fee.branchId, BRANCH);
    assert.equal(capturedFind.where.paymentDate.gte.toISOString(), "2026-09-12T18:30:00.000Z");
    assert.equal(capturedFind.where.paymentDate.lt.toISOString(), "2026-09-13T18:30:00.000Z");
  });

  await t.test("payment search matches the current payment directly and related fee context separately", async () => {
    const receipt = await get(Role.SUPER_ADMIN, `?branchId=${BRANCH}&search=receipt-1`);
    assert.equal(receipt.status, 200);
    assert.deepEqual(receipt.payload.data.map((item: any) => item.receiptNumber), ["receipt-1"]);
    assert.equal(capturedFind.where.fee.branchId, BRANCH);
    assert.equal(capturedFind.where.OR[0].receiptNumber.contains, "receipt-1");
    assert.equal(capturedFind.where.OR.some((clause: any) => clause.fee?.payments), false);

    const transaction = await get(Role.SUPER_ADMIN, `?branchId=${BRANCH}&search=txn-2`);
    assert.deepEqual(transaction.payload.data.map((item: any) => item.transactionId), ["txn-2"]);
    assert.equal(capturedFind.where.OR[1].transactionId.contains, "txn-2");

    assert.equal((await get(Role.SUPER_ADMIN, `?branchId=${BRANCH}&search=Student%20One`)).payload.data.length, 2);
    assert.equal((await get(Role.SUPER_ADMIN, `?branchId=${BRANCH}&search=Tuition`)).payload.data.length, 2);
  });

  for (const role of [Role.BRANCH_ADMIN, Role.ACCOUNTANT]) {
    await t.test(`${role} reads only assigned branches and zero assignments return empty`, async () => {
      assignedBranches = [BRANCH];
      assert.equal((await get(role, `?branchId=${BRANCH}`)).status, 200);
      assert.equal((await get(role, `?branchId=${OTHER_BRANCH}`)).status, 403);
      assignedBranches = [];
      const empty = await get(role);
      assert.equal(empty.status, 200);
      assert.deepEqual(empty.payload.meta, { total: 0, page: 1, limit: 20, totalPages: 1 });
      assert.deepEqual(empty.payload.data, []);
    });
  }

  await t.test("cross-tenant requests cannot expose payment history", async () => {
    assert.equal((await get(Role.SUPER_ADMIN, "", ORG, OTHER_ORG)).status, 403);
    const hidden = await get(Role.SUPER_ADMIN, "?search=receipt-1", OTHER_ORG);
    assert.equal(hidden.status, 200);
    assert.deepEqual(hidden.payload.data, []);
  });

  await t.test("Branch Admin search cannot cross its assigned branch", async () => {
    assignedBranches = [BRANCH];
    assert.equal((await get(Role.BRANCH_ADMIN, `?branchId=${OTHER_BRANCH}&search=receipt-1`)).status, 403);
  });

  await t.test("collection reports accept complete institution days and reject reverse ranges", async () => {
    requestOrganization = ORG;
    const report = async (from: string, to: string) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/admin/fees/reports?from=${from}&to=${to}`, { headers: { Authorization: `Bearer ${token(Role.SUPER_ADMIN)}` } });
      return { status: response.status, payload: await response.json() as any };
    };
    assert.equal((await report("2026-09-13", "2026-09-13")).status, 200);
    assert.equal(capturedAggregate.where.paymentDate.gte.toISOString(), "2026-09-12T18:30:00.000Z");
    assert.equal(capturedAggregate.where.paymentDate.lt.toISOString(), "2026-09-13T18:30:00.000Z");
    assert.equal((await report("2026-09-13", "2026-09-15")).status, 200);
    assert.equal(capturedAggregate.where.paymentDate.lt.toISOString(), "2026-09-15T18:30:00.000Z");
    const invalid = await report("2026-09-15", "2026-09-13");
    assert.equal(invalid.status, 422);
    assert.equal(invalid.payload.error.code, "INVALID_DATE_RANGE");
  });
});
