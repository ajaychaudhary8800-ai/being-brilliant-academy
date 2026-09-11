import "express-async-errors";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { FeeStatus, Role } from "@prisma/client";
import express from "express";
import jwt from "jsonwebtoken";
import { env } from "../config.js";
import { errorHandler } from "../lib/http.js";
import { prisma, systemPrisma } from "../lib/prisma.js";
import adminFees from "./admin-fees.js";
import finance from "./finance.js";

const ORGANIZATION_ID = "organization-fee-adjustment-test";
const USER_ID = "super-admin-fee-adjustment-test";
const FEE_ID = "cfee000000000000000000001";
const STUDENT_ID = "cstudent00000000000000001";
const BRANCH_ID = "cbranch000000000000000001";
const COURSE_ID = "ccourse000000000000000001";
const BATCH_ID = "cbatch0000000000000000001";
const YEAR_ID = "cyear000000000000000000001";
const DEBIT_ACCOUNT_ID = "caccount00000000000000001";
const CREDIT_ACCOUNT_ID = "caccount00000000000000002";

type FeeRecord = {
  id: string;
  studentId: string;
  branchId: string;
  courseId: string | null;
  batchId: string | null;
  feeHead: string;
  totalPaise: number;
  discountPaise: number;
  finePaise: number;
  amountPaidPaise: number;
  dueDate: Date;
  status: FeeStatus;
};
type Store = { fee: FeeRecord; journals: any[]; adjustments: any[]; audits: any[]; feeUpdates: number };

test("paid fee and fee-adjustment production routes preserve financial history behaviorally", async t => {
  let store: Store;
  let failAudit = false;
  let transactionIsolation: string | null = null;
  let sequence = 0;

  function feeFixture(overrides: Partial<FeeRecord> = {}): FeeRecord {
    return {
      id: FEE_ID,
      studentId: STUDENT_ID,
      branchId: BRANCH_ID,
      courseId: COURSE_ID,
      batchId: BATCH_ID,
      feeHead: "Tuition",
      totalPaise: 10_000,
      discountPaise: 0,
      finePaise: 0,
      amountPaidPaise: 9_000,
      dueDate: new Date("2099-06-30T00:00:00.000Z"),
      status: FeeStatus.PARTIAL,
      ...overrides,
    };
  }

  function reset(overrides: Partial<FeeRecord> = {}) {
    store = { fee: feeFixture(overrides), journals: [], adjustments: [], audits: [], feeUpdates: 0 };
    failAudit = false;
    transactionIsolation = null;
  }

  function copyStore(value: Store): Store {
    return {
      fee: { ...value.fee, dueDate: new Date(value.fee.dueDate) },
      journals: value.journals.map(row => ({ ...row })),
      adjustments: value.adjustments.map(row => ({ ...row })),
      audits: value.audits.map(row => ({ ...row })),
      feeUpdates: value.feeUpdates,
    };
  }

  function transactionClient(local: Store) {
    return {
      fee: {
        findUnique: async ({ where }: any) => where.id === FEE_ID ? { ...local.fee, _count: { payments: 1 } } : null,
        update: async ({ data }: any) => {
          local.fee = { ...local.fee, ...data };
          local.feeUpdates += 1;
          return local.fee;
        },
      },
      studentProfile: {
        findUnique: async ({ where }: any) => where.id === local.fee.studentId ? { branchId: BRANCH_ID, batchId: BATCH_ID, batch: { courseId: COURSE_ID } } : null,
      },
      financialYear: {
        findFirst: async ({ where }: any) => where.id === YEAR_ID && where.branchId === BRANCH_ID ? { id: YEAR_ID, startsAt: new Date("2020-01-01T00:00:00.000Z"), endsAt: new Date("2100-01-01T00:00:00.000Z"), isLocked: false } : null,
      },
      ledgerAccount: {
        findMany: async ({ where }: any) => (where.id.in as string[]).map(id => ({ id, branchId: BRANCH_ID, type: "ASSET" })),
      },
      journalEntry: {
        create: async ({ data }: any) => {
          const row = { id: `journal-${++sequence}`, ...data };
          local.journals.push(row);
          return row;
        },
      },
      feeAdjustment: {
        create: async ({ data }: any) => {
          const row = { id: `adjustment-${++sequence}`, ...data };
          local.adjustments.push(row);
          return row;
        },
      },
      auditLog: {
        create: async ({ data }: any) => {
          if (failAudit) throw new Error("Simulated AuditLog failure");
          local.audits.push(data);
          return data;
        },
      },
    };
  }

  const patches: Array<() => void> = [];
  function patch(target: any, property: string, replacement: (...args: any[]) => any) {
    const original = target[property];
    target[property] = replacement;
    patches.unshift(() => { target[property] = original; });
  }

  reset();
  patch((systemPrisma as any).organization, "findUnique", async () => ({ id: ORGANIZATION_ID, isActive: true, deletedAt: null, subscriptionStatus: "ACTIVE", trialEndsAt: null, subscriptionEndsAt: null }));
  patch((systemPrisma as any).user, "findFirst", async () => ({ isActive: true }));
  patch((systemPrisma as any).tenantAccessAudit, "create", async () => ({}));
  patch(prisma as any, "$transaction", async (operation: any, options: any) => {
    transactionIsolation = options?.isolationLevel ?? null;
    const local = copyStore(store);
    const result = await operation(transactionClient(local));
    store = local;
    return result;
  });

  const application = express();
  application.use(express.json());
  application.use("/api/v1/admin", adminFees);
  application.use("/api/v1", finance);
  application.use(errorHandler);
  const server = application.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const port = (server.address() as AddressInfo).port;
  const token = jwt.sign({ userId: USER_ID, role: Role.SUPER_ADMIN, organizationId: ORGANIZATION_ID }, env.JWT_ACCESS_SECRET, { expiresIn: "5m" });

  async function request(path: string, method: string, body: unknown) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, payload: await response.json() as any };
  }

  const adjust = (type: "REFUND" | "DISCOUNT" | "SCHOLARSHIP" | "FINE", amountPaise: number) => request("/api/v1/finance/fee-adjustments", "POST", {
    feeId: FEE_ID,
    financialYearId: YEAR_ID,
    voucherNumber: `ADJ-${++sequence}`,
    type,
    amountPaise,
    reason: `${type} behavioral test`,
    reference: `reference-${type.toLowerCase()}-${sequence}`,
    debitAccountId: DEBIT_ACCOUNT_ID,
    creditAccountId: CREDIT_ACCOUNT_ID,
  });

  try {
    await t.test("a paid Fee rejects direct mutation of every protected identity and obligation field", async () => {
      const mutations: Record<string, unknown>[] = [
        { studentId: "cstudent00000000000000002" },
        { branchId: "cbranch000000000000000002" },
        { courseId: "ccourse000000000000000002" },
        { batchId: "cbatch0000000000000000002" },
        { feeHead: "Transport" },
        { totalPaise: 12_000 },
        { discountPaise: 100 },
        { finePaise: 100 },
        { dueDate: "2099-07-31" },
      ];
      for (const mutation of mutations) {
        reset();
        const before = copyStore(store);
        const response = await request(`/api/v1/admin/fees/${FEE_ID}`, "PATCH", mutation);
        assert.equal(response.status, 409);
        assert.equal(response.payload.error.code, "PAID_FEE_IDENTITY_LOCKED");
        assert.deepEqual(store, before);
      }
    });

    await t.test("DISCOUNT updates operational discount and recalculates status", async () => {
      reset({ amountPaidPaise: 9_000, status: FeeStatus.PARTIAL });
      const response = await adjust("DISCOUNT", 1_000);
      assert.equal(response.status, 201);
      assert.equal(store.fee.discountPaise, 1_000);
      assert.equal(store.fee.finePaise, 0);
      assert.equal(store.fee.status, FeeStatus.PAID);
      assert.equal(store.feeUpdates, 1);
    });

    await t.test("SCHOLARSHIP updates operational discount and recalculates status", async () => {
      reset({ amountPaidPaise: 9_000, status: FeeStatus.PARTIAL });
      const response = await adjust("SCHOLARSHIP", 1_000);
      assert.equal(response.status, 201);
      assert.equal(store.fee.discountPaise, 1_000);
      assert.equal(store.fee.status, FeeStatus.PAID);
      assert.equal(store.feeUpdates, 1);
    });

    await t.test("FINE updates operational fine and recalculates status", async () => {
      reset({ amountPaidPaise: 10_000, status: FeeStatus.PAID });
      const response = await adjust("FINE", 500);
      assert.equal(response.status, 201);
      assert.equal(store.fee.discountPaise, 0);
      assert.equal(store.fee.finePaise, 500);
      assert.equal(store.fee.status, FeeStatus.PARTIAL);
      assert.equal(store.feeUpdates, 1);
    });

    await t.test("an adjustment cannot reduce the obligation below the amount paid", async () => {
      reset({ amountPaidPaise: 9_500, status: FeeStatus.PARTIAL });
      const before = copyStore(store);
      const response = await adjust("DISCOUNT", 1_000);
      assert.equal(response.status, 422);
      assert.equal(response.payload.error.code, "ADJUSTMENT_BELOW_PAID");
      assert.deepEqual(store, before);
    });

    await t.test("journal, adjustment, Fee update and audit commit together", async () => {
      reset({ amountPaidPaise: 5_000 });
      const response = await adjust("DISCOUNT", 1_000);
      assert.equal(response.status, 201);
      assert.equal(transactionIsolation, "Serializable");
      assert.equal(store.journals.length, 1);
      assert.equal(store.adjustments.length, 1);
      assert.equal(store.feeUpdates, 1);
      assert.equal(store.audits.length, 1);
      assert.equal(store.adjustments[0]!.journalEntryId, store.journals[0]!.id);
      assert.equal(store.audits[0]!.entityId, store.adjustments[0]!.id);
    });

    await t.test("AuditLog failure rolls back journal, adjustment and Fee update", async () => {
      reset({ amountPaidPaise: 5_000 });
      const before = copyStore(store);
      failAudit = true;
      const response = await adjust("DISCOUNT", 1_000);
      assert.equal(response.status, 500);
      assert.deepEqual(store, before);
    });

    await t.test("REFUND remains accounting-only and does not mutate payment or operational Fee totals", async () => {
      reset({ amountPaidPaise: 10_000, status: FeeStatus.PAID });
      const before = { ...store.fee };
      const response = await adjust("REFUND", 2_000);
      assert.equal(response.status, 201);
      assert.equal(response.payload.meta.refundSemantics, "ACCOUNTING_ADJUSTMENT_ONLY");
      assert.equal(response.payload.meta.paymentRefunded, false);
      assert.equal(response.payload.meta.paymentReversalCreated, false);
      assert.equal(store.journals.length, 1);
      assert.equal(store.adjustments.length, 1);
      assert.equal(store.audits.length, 1);
      assert.equal(store.feeUpdates, 0);
      assert.deepEqual(store.fee, before);
      assert.match(store.journals[0]!.narration, /no payment reversal/i);
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    for (const restore of patches) restore();
  }
});
