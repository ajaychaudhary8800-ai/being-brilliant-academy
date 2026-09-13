import "express-async-errors";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { FeePaymentOffsetType, FeeStatus, PaymentMode, Role } from "@prisma/client";
import express from "express";
import jwt from "jsonwebtoken";
import { env } from "../config.js";
import { errorHandler } from "../lib/http.js";
import { prisma, systemPrisma } from "../lib/prisma.js";
import adminFees from "./admin-fees.js";

const ORGANIZATION_ID = "organization-fee-collection-test";
const USER_ID = "super-admin-fee-collection-test";
const FEE_ID = "cfee000000000000000000001";
const BRANCH_ID = "cbranch000000000000000001";

type Payment = { id: string; organizationId: string; feeId: string; amountPaise: number; paymentMode: PaymentMode; receiptNumber: string; transactionId: string | null };
type Offset = { id: string; organizationId: string; feeId: string; feePaymentId: string; type: FeePaymentOffsetType; amountPaise: number };
type Store = {
  fee: { id: string; branchId: string; totalPaise: number; discountPaise: number; finePaise: number; amountPaidPaise: number; dueDate: Date; status: FeeStatus; studentFeeAssignmentId: string | null; feePlanComponentId: string | null };
  payments: Payment[];
  offsets: Offset[];
  audits: any[];
  feeUpdates: number;
};

test("fee collection uses effective paid across immutable payments and offsets", async t => {
  let store: Store;
  let paymentSequence = 0;
  let transactionIsolation: string | null = null;
  let aggregateScopes: Array<{ organizationId?: string; feeId?: string }> = [];

  const payment = (id: string, amountPaise: number): Payment => ({ id, organizationId: ORGANIZATION_ID, feeId: FEE_ID, amountPaise, paymentMode: PaymentMode.UPI, receiptNumber: `receipt-${id}`, transactionId: null });
  const offset = (id: string, feePaymentId: string, amountPaise: number, type: FeePaymentOffsetType): Offset => ({ id, organizationId: ORGANIZATION_ID, feeId: FEE_ID, feePaymentId, amountPaise, type });
  const clone = (value: Store): Store => ({ fee: { ...value.fee, dueDate: new Date(value.fee.dueDate) }, payments: value.payments.map(row => ({ ...row })), offsets: value.offsets.map(row => ({ ...row })), audits: value.audits.map(row => ({ ...row })), feeUpdates: value.feeUpdates });
  const reset = ({ payments = [], offsets = [], amountPaidPaise = 0, generated = false }: { payments?: Payment[]; offsets?: Offset[]; amountPaidPaise?: number; generated?: boolean } = {}) => {
    store = {
      fee: { id: FEE_ID, branchId: BRANCH_ID, totalPaise: 10_000, discountPaise: 0, finePaise: 0, amountPaidPaise, dueDate: new Date("2099-06-30T00:00:00.000Z"), status: amountPaidPaise === 10_000 ? FeeStatus.PAID : amountPaidPaise > 0 ? FeeStatus.PARTIAL : FeeStatus.PENDING, studentFeeAssignmentId: generated ? "assignment-batch-2" : null, feePlanComponentId: generated ? "component-batch-2" : null },
      payments: payments.map(row => ({ ...row })), offsets: offsets.map(row => ({ ...row })), audits: [], feeUpdates: 0,
    };
    paymentSequence = payments.length;
    transactionIsolation = null;
    aggregateScopes = [];
  };

  const transactionClient = (local: Store) => ({
    fee: {
      findUnique: async ({ where }: any) => where.id === FEE_ID ? { ...local.fee } : null,
      update: async ({ data }: any) => { local.fee = { ...local.fee, ...data }; local.feeUpdates += 1; return { ...local.fee }; },
    },
    feePayment: {
      findUnique: async ({ where }: any) => local.payments.find(row => row.transactionId === where.transactionId) ?? null,
      aggregate: async ({ where }: any) => { aggregateScopes.push(where); return { _sum: { amountPaise: local.payments.filter(row => row.organizationId === where.organizationId && row.feeId === where.feeId).reduce((sum, row) => sum + row.amountPaise, 0) || null } }; },
      create: async ({ data }: any) => { const row = { id: `new-payment-${++paymentSequence}`, organizationId: ORGANIZATION_ID, feeId: data.feeId, amountPaise: data.amountPaise, paymentMode: data.paymentMode, receiptNumber: data.receiptNumber, transactionId: data.transactionId ?? null }; local.payments.push(row); return row; },
    },
    feePaymentOffset: {
      aggregate: async ({ where }: any) => { aggregateScopes.push(where); return { _sum: { amountPaise: local.offsets.filter(row => row.organizationId === where.organizationId && row.feeId === where.feeId).reduce((sum, row) => sum + row.amountPaise, 0) || null } }; },
    },
    auditLog: { create: async ({ data }: any) => { local.audits.push(data); return data; } },
  });

  const patches: Array<() => void> = [];
  const patch = (target: any, property: string, replacement: (...args: any[]) => any) => { const original = target[property]; target[property] = replacement; patches.unshift(() => { target[property] = original; }); };
  reset();
  patch((systemPrisma as any).organization, "findUnique", async () => ({ id: ORGANIZATION_ID, isActive: true, deletedAt: null, subscriptionStatus: "ACTIVE", trialEndsAt: null, subscriptionEndsAt: null }));
  patch((systemPrisma as any).user, "findFirst", async () => ({ isActive: true }));
  patch((systemPrisma as any).tenantAccessAudit, "create", async () => ({}));
  patch(prisma as any, "$transaction", async (operation: any, options: any) => { transactionIsolation = options?.isolationLevel ?? null; const local = clone(store); const result = await operation(transactionClient(local)); store = local; return result; });

  const application = express();
  application.use(express.json());
  application.use("/api/v1/admin", adminFees);
  application.use(errorHandler);
  const server = application.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const port = (server.address() as AddressInfo).port;
  const bearer = jwt.sign({ userId: USER_ID, role: Role.SUPER_ADMIN, organizationId: ORGANIZATION_ID }, env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
  const collect = async (amountPaise: number) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/admin/fees/${FEE_ID}/collect`, { method: "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: JSON.stringify({ amountPaise, paymentMode: PaymentMode.UPI }) });
    return { status: response.status, payload: await response.json() as any };
  };

  try {
    for (const type of [FeePaymentOffsetType.REFUND, FeePaymentOffsetType.REVERSAL]) {
      await t.test(`collection after ${type.toLowerCase()} uses the restored balance`, async () => {
        reset({ payments: [payment("original", 8_000)], offsets: [offset("offset", "original", 2_000, type)], amountPaidPaise: 6_000 });
        const originalPayment = { ...store.payments[0]! }, originalOffset = { ...store.offsets[0]! };
        const response = await collect(4_000);
        assert.equal(response.status, 201); assert.equal(response.payload.data.payment.amountPaise, 4_000); assert.equal(response.payload.data.fee.amountPaidPaise, 10_000); assert.equal(response.payload.data.fee.status, FeeStatus.PAID);
        assert.equal(store.fee.amountPaidPaise, 10_000); assert.equal(store.fee.status, FeeStatus.PAID); assert.equal(store.feeUpdates, 1); assert.equal(store.audits.length, 2); assert.deepEqual(store.payments[0], originalPayment); assert.deepEqual(store.offsets[0], originalOffset);
        assert.equal(transactionIsolation, "Serializable"); assert.ok(aggregateScopes.every(where => where.organizationId === ORGANIZATION_ID && where.feeId === FEE_ID));
      });
    }

    await t.test("multiple payments and offsets use net effective paid and reject over-collection", async () => {
      reset({ payments: [payment("payment-a", 6_000), payment("payment-b", 2_000)], offsets: [offset("refund-a", "payment-a", 1_500, FeePaymentOffsetType.REFUND), offset("reversal-b", "payment-b", 500, FeePaymentOffsetType.REVERSAL)], amountPaidPaise: 6_000 });
      const history = { payments: store.payments.map(row => ({ ...row })), offsets: store.offsets.map(row => ({ ...row })) };
      const over = await collect(4_001);
      assert.equal(over.status, 422); assert.equal(over.payload.error.code, "PAYMENT_EXCEEDS_BALANCE"); assert.equal(store.payments.length, 2); assert.equal(store.audits.length, 0); assert.equal(store.feeUpdates, 0);
      const valid = await collect(4_000);
      assert.equal(valid.status, 201); assert.equal(store.payments.reduce((sum, row) => sum + row.amountPaise, 0), 12_000); assert.equal(store.offsets.reduce((sum, row) => sum + row.amountPaise, 0), 2_000); assert.equal(store.fee.amountPaidPaise, 10_000); assert.equal(store.fee.status, FeeStatus.PAID); assert.deepEqual(store.payments.slice(0, 2), history.payments); assert.deepEqual(store.offsets, history.offsets);
    });

    await t.test("ledger inconsistency rejects collection without any side effect", async () => {
      reset({ payments: [payment("original", 8_000)], offsets: [offset("refund", "original", 2_000, FeePaymentOffsetType.REFUND)], amountPaidPaise: 6_500 });
      const before = clone(store), response = await collect(3_500);
      assert.equal(response.status, 409); assert.equal(response.payload.error.code, "PAYMENT_LEDGER_INCONSISTENT"); assert.deepEqual(store, before);
    });

    for (const generated of [false, true]) {
      await t.test(`${generated ? "Batch 2 generated" : "legacy manual"} Fee remains collectible after an offset`, async () => {
        reset({ payments: [payment("original", 8_000)], offsets: [offset("refund", "original", 2_000, FeePaymentOffsetType.REFUND)], amountPaidPaise: 6_000, generated });
        const source = { studentFeeAssignmentId: store.fee.studentFeeAssignmentId, feePlanComponentId: store.fee.feePlanComponentId };
        const response = await collect(4_000);
        assert.equal(response.status, 201); assert.equal(store.fee.amountPaidPaise, 10_000); assert.deepEqual({ studentFeeAssignmentId: store.fee.studentFeeAssignmentId, feePlanComponentId: store.fee.feePlanComponentId }, source);
      });
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    for (const restore of patches) restore();
  }
});
