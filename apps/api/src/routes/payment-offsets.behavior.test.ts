import "express-async-errors";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { FeePaymentOffsetType, FeeStatus, PaymentMode, Prisma, Role } from "@prisma/client";
import express from "express";
import jwt from "jsonwebtoken";
import { env } from "../config.js";
import { errorHandler } from "../lib/http.js";
import { prisma, systemPrisma } from "../lib/prisma.js";
import paymentOffsets from "./payment-offsets.js";

const ORG = "org-payment-offset-test";
const USER = "cuser00000000000000000001";
const FEE = "cfee000000000000000000001";
const PAYMENT = "cpayment00000000000000001";
const PAYMENT_2 = "cpayment00000000000000002";
const BRANCH = "cbranch000000000000000001";

test("payment offset routes enforce immutable, idempotent ledger behavior", async t => {
  type State = { payment: any; payment2: any; fee: any; offsets: any[]; audits: any[] };
  let state: State;
  let assignedBranches = [BRANCH];
  let failCreate = false;
  let failUpdate = false;
  let failAudit = false;
  let forceP2002 = false;
  let requestedPaymentId = PAYMENT;
  const reset = () => {
    state = {
      payment: { organizationId: ORG, id: PAYMENT, feeId: FEE, amountPaise: 10_000, paymentMode: PaymentMode.UPI },
      payment2: { organizationId: ORG, id: PAYMENT_2, feeId: FEE, amountPaise: 5_000, paymentMode: PaymentMode.CASH },
      fee: { id: FEE, organizationId: ORG, studentId: "student-1", branchId: BRANCH, totalPaise: 15_000, discountPaise: 0, finePaise: 0, amountPaidPaise: 10_000, dueDate: new Date("2099-01-01"), status: FeeStatus.PAID },
      offsets: [], audits: [],
    };
    assignedBranches = [BRANCH]; failCreate = false; failUpdate = false; failAudit = false; forceP2002 = false; requestedPaymentId = PAYMENT;
  };
  reset();
  const clone = (value: State): State => ({ payment: { ...value.payment }, payment2: { ...value.payment2 }, fee: { ...value.fee }, offsets: value.offsets.map(row => ({ ...row })), audits: value.audits.map(row => ({ ...row })) });
  const patchers: Array<() => void> = [];
  const patch = (target: any, key: string, value: any) => { const old = target[key]; target[key] = value; patchers.unshift(() => { target[key] = old; }); };
  const relations = (local: State, offset: any) => {
    const payment = offset.feePaymentId === PAYMENT_2 ? local.payment2 : local.payment;
    return { ...offset, feePayment: { ...payment, fee: { ...local.fee } }, createdBy: { id: USER, name: "Finance Admin", email: "admin@example.test" } };
  };

  patch((systemPrisma as any).organization, "findUnique", async () => ({ id: ORG, isActive: true, deletedAt: null, subscriptionStatus: "ACTIVE", trialEndsAt: null, subscriptionEndsAt: null }));
  patch((systemPrisma as any).user, "findFirst", async () => ({ isActive: true }));
  patch((systemPrisma as any).tenantAccessAudit, "create", async () => ({}));
  patch((prisma as any).branchUser, "findMany", async () => assignedBranches.map(branchId => ({ branchId })));
  patch((systemPrisma as any).branchUser, "findMany", async () => assignedBranches.map(branchId => ({ branchId })));
  const offsetAggregate = async ({ where }: any) => ({ _sum: { amountPaise: state.offsets.filter(row => row.organizationId === where.organizationId && row.feePaymentId === where.feePaymentId).reduce((sum, row) => sum + row.amountPaise, 0) || null } });
  const offsetFindUnique = async ({ where, include }: any) => { const row = state.offsets.find(item => item.organizationId === where.organizationId_idempotencyKey.organizationId && item.idempotencyKey === where.organizationId_idempotencyKey.idempotencyKey); return row && include ? relations(state, row) : row ?? null; };
  patch((systemPrisma as any).feePaymentOffset, "aggregate", offsetAggregate);
  patch((systemPrisma as any).feePaymentOffset, "findUnique", offsetFindUnique);
  patch((systemPrisma as any).feePaymentOffset, "findMany", async () => state.offsets.map(row => relations(state, row)));
  patch((systemPrisma as any).feePaymentOffset, "count", async () => state.offsets.length);
  patch((systemPrisma as any).feePaymentOffset, "findFirst", async ({ where }: any) => { const row = state.offsets.find(item => item.id === where.id && item.organizationId === where.organizationId); return row ? relations(state, row) : null; });
  patch((prisma as any).feePaymentOffset, "aggregate", offsetAggregate);
  patch((prisma as any).feePaymentOffset, "findUnique", offsetFindUnique);
  patch((prisma as any).feePaymentOffset, "findMany", async () => state.offsets.map(row => relations(state, row)));
  patch((prisma as any).feePaymentOffset, "count", async () => state.offsets.length);
  patch((prisma as any).feePaymentOffset, "findFirst", async ({ where }: any) => { const row = state.offsets.find(item => item.id === where.id && item.organizationId === where.organizationId); return row ? relations(state, row) : null; });
    const transaction = async (work: any) => {
    if (forceP2002) throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
    const local = clone(state);
    const tx: any = {
      $queryRaw: async () => [requestedPaymentId === PAYMENT_2 ? local.payment2 : local.payment],
      branchUser: (prisma as any).branchUser,
      fee: { findUnique: async () => ({ ...local.fee }), update: async ({ data }: any) => { if (failUpdate) throw new Error("Fee update failed"); local.fee = { ...local.fee, ...data }; return local.fee; } },
      feePayment: {
        aggregate: async ({ where }: any) => ({ _sum: { amountPaise: local.payment.feeId === where.feeId ? local.payment.amountPaise : null } }),
      },
      feePaymentOffset: {
        findUnique: async ({ where, include }: any) => { const row = local.offsets.find(item => item.organizationId === where.organizationId_idempotencyKey.organizationId && item.idempotencyKey === where.organizationId_idempotencyKey.idempotencyKey); return row && include ? relations(local, row) : row ?? null; },
        aggregate: async ({ where }: any) => ({ _sum: { amountPaise: local.offsets.filter(item => item.organizationId === where.organizationId && (where.feePaymentId ? item.feePaymentId === where.feePaymentId : item.feeId === where.feeId)).reduce((sum, item) => sum + item.amountPaise, 0) || null } }),
        create: async ({ data, include }: any) => { if (failCreate) throw new Error("Offset create failed"); const row = { id: `offset-${local.offsets.length + 1}`, createdAt: new Date(), ...data }; local.offsets.push(row); return include ? relations(local, row) : row; },
      },
      auditLog: { create: async ({ data }: any) => { if (failAudit) throw new Error("Audit failure"); local.audits.push(data); return data; } },
    };
    const result = await work(tx);
    state = local;
    return result;
  };
  patch((systemPrisma as any), "$transaction", transaction);
  const app = express();
  app.use(express.json());
  app.use("/api/v1", paymentOffsets);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const port = (server.address() as AddressInfo).port;
  const token = (role: Role, organizationId = ORG) => jwt.sign({ userId: USER, role, organizationId }, env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
  const request = async (role: Role, path: string, body?: unknown, organizationId = ORG) => {
    const paymentMatch = path.match(/payments\/([^/]+)/);
    if (paymentMatch) requestedPaymentId = paymentMatch[1];
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token(role, organizationId)}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, payload: await response.json() as any };
  };
  const seedOffset = (overrides: Record<string, unknown> = {}) => {
    state.offsets.push({ id: "offset-seeded", organizationId: ORG, feePaymentId: PAYMENT, feeId: FEE, type: FeePaymentOffsetType.REFUND, amountPaise: 1_000, reason: "Seeded", idempotencyKey: "seeded-key", reference: null, createdById: USER, createdAt: new Date(), ...overrides });
  };
  try {
    await t.test("refund is capped, reduces Fee exactly once, and exact retry is idempotent", async () => {
      reset();
      const body = { amountPaise: 4_000, reason: "Customer refund", idempotencyKey: "refund-1", reference: "R-1" };
      const first = await request(Role.SUPER_ADMIN, `/api/v1/finance/payments/${PAYMENT}/refunds`, body);
      const retry = await request(Role.SUPER_ADMIN, `/api/v1/finance/payments/${PAYMENT}/refunds`, body);
      assert.equal(first.status, 201); assert.equal(first.payload.created, true); assert.equal(first.payload.data.effectiveAmountPaidPaise, 6_000); assert.equal(first.payload.data.currentFeeStatus, FeeStatus.PARTIAL);
      assert.equal(retry.status, 200); assert.equal(retry.payload.created, false); assert.equal(retry.payload.data.effectiveAmountPaidPaise, 6_000); assert.equal(retry.payload.data.currentFeeStatus, FeeStatus.PARTIAL);
      assert.equal(state.offsets.length, 1); assert.equal(state.fee.amountPaidPaise, 6_000); assert.equal(state.fee.status, FeeStatus.PARTIAL); assert.equal(state.payment.amountPaise, 10_000); assert.equal(state.audits.length, 1);
      const conflict = await request(Role.SUPER_ADMIN, `/api/v1/finance/payments/${PAYMENT}/refunds`, { ...body, amountPaise: 1_000 });
      assert.equal(conflict.status, 409); assert.equal(conflict.payload.error.code, "PAYMENT_OFFSET_IDEMPOTENCY_CONFLICT");
      const unknown = await request(Role.SUPER_ADMIN, `/api/v1/finance/payments/${PAYMENT}/refunds`, { amountPaise: 1_000, reason: "Unknown field", idempotencyKey: "unknown", feeId: FEE });
      assert.equal(unknown.status, 422);
    });
    await t.test("idempotency keys reject every immutable-intent mismatch without side effects", async () => {
      reset();
      const body = { amountPaise: 1_000, reason: "Matrix", idempotencyKey: "matrix-key", reference: "M-1" };
      const first = await request(Role.SUPER_ADMIN, `/api/v1/finance/payments/${PAYMENT}/refunds`, body);
      assert.equal(first.status, 201);
      const attempts = [
        { path: `/api/v1/finance/payments/${PAYMENT}/refunds`, body: { ...body, amountPaise: 2_000 } },
        { path: `/api/v1/finance/payments/${PAYMENT_2}/refunds`, body },
        { path: `/api/v1/finance/payments/${PAYMENT}/reversals`, body },
        { path: `/api/v1/finance/payments/${PAYMENT}/refunds`, body: { ...body, reason: "Other reason" } },
        { path: `/api/v1/finance/payments/${PAYMENT}/refunds`, body: { ...body, reference: "M-2" } },
      ];
      for (const attempt of attempts) {
        const response = await request(Role.SUPER_ADMIN, attempt.path, attempt.body);
        assert.equal(response.status, 409);
        assert.equal(response.payload.error.code, "PAYMENT_OFFSET_IDEMPOTENCY_CONFLICT");
      }
      assert.equal(state.offsets.length, 1);
      assert.equal(state.fee.amountPaidPaise, 9_000);
      assert.equal(state.audits.length, 1);
    });
    await t.test("reversal shares the same original-payment cap", async () => {
      reset();
      const reversal = await request(Role.SUPER_ADMIN, `/api/v1/finance/payments/${PAYMENT}/reversals`, { amountPaise: 7_000, reason: "Bank reversal", idempotencyKey: "reverse-1" });
      const excess = await request(Role.SUPER_ADMIN, `/api/v1/finance/payments/${PAYMENT}/refunds`, { amountPaise: 4_000, reason: "Too much", idempotencyKey: "refund-2" });
      assert.equal(reversal.status, 201); assert.equal(excess.status, 422); assert.equal(state.offsets.length, 1); assert.equal(state.fee.amountPaidPaise, 3_000);
    });
    await t.test("accountants cannot create offsets", async () => {
      reset();
      const response = await request(Role.ACCOUNTANT, `/api/v1/finance/payments/${PAYMENT}/refunds`, { amountPaise: 1_000, reason: "No", idempotencyKey: "accountant-1" });
      assert.equal(response.status, 403); assert.equal(state.offsets.length, 0);
      const reversal = await request(Role.ACCOUNTANT, `/api/v1/finance/payments/${PAYMENT}/reversals`, { amountPaise: 1_000, reason: "No", idempotencyKey: "accountant-reversal" });
      assert.equal(reversal.status, 403); assert.equal(state.offsets.length, 0);
    });
    await t.test("branch administrators require an assigned branch before any write", async () => {
      reset(); assignedBranches = ["another-branch"];
      const initiallyUnassigned = await request(Role.BRANCH_ADMIN, `/api/v1/finance/payments/${PAYMENT}/refunds`, { amountPaise: 1_000, reason: "Unassigned", idempotencyKey: "unassigned" });
      assert.equal(initiallyUnassigned.status, 403);
      assignedBranches = [];
      const zeroBranch = await request(Role.BRANCH_ADMIN, `/api/v1/finance/payments/${PAYMENT}/refunds`, { amountPaise: 1_000, reason: "Zero branch", idempotencyKey: "zero-branch" });
      assert.equal(zeroBranch.status, 403);
      assert.equal(state.offsets.length, 0);
    });
    await t.test("accountant assigned reads succeed while detail and zero-branch reads stay scoped", async () => {
      reset();
      seedOffset();
      const list = await request(Role.ACCOUNTANT, "/api/v1/finance/payment-offsets");
      const detail = await request(Role.ACCOUNTANT, "/api/v1/finance/payment-offsets/offset-seeded");
      assert.equal(list.status, 200); assert.equal(list.payload.meta.total, 1);
      assert.equal(detail.status, 200); assert.equal(detail.payload.data.id, "offset-seeded");
      assignedBranches = [];
      const empty = await request(Role.ACCOUNTANT, "/api/v1/finance/payment-offsets");
      assert.equal(empty.status, 200); assert.deepEqual(empty.payload.data, []);
    });
    await t.test("branch authorization runs before idempotent replay and supports both operation types", async () => {
      reset();
      const first = await request(Role.BRANCH_ADMIN, `/api/v1/finance/payments/${PAYMENT}/refunds`, { amountPaise: 1_000, reason: "Assigned", idempotencyKey: "branch-1" });
      const reversal = await request(Role.BRANCH_ADMIN, `/api/v1/finance/payments/${PAYMENT}/reversals`, { amountPaise: 1_000, reason: "Assigned reversal", idempotencyKey: "branch-2" });
      assert.equal(first.status, 201); assert.equal(reversal.status, 201);
      assignedBranches = [];
      const replay = await request(Role.BRANCH_ADMIN, `/api/v1/finance/payments/${PAYMENT}/refunds`, { amountPaise: 1_000, reason: "Assigned", idempotencyKey: "branch-1" });
      assert.equal(replay.status, 403); assert.equal(state.offsets.length, 2);
      const emptyAccountant = await request(Role.ACCOUNTANT, "/api/v1/finance/payment-offsets");
      assert.equal(emptyAccountant.status, 200); assert.deepEqual(emptyAccountant.payload.data, []);
    });
    await t.test("atomic failures do not commit an offset or Fee mutation", async () => {
      for (const failure of ["create", "update", "audit"] as const) {
        reset();
        if (failure === "create") failCreate = true;
        if (failure === "update") failUpdate = true;
        if (failure === "audit") failAudit = true;
        const response = await request(Role.SUPER_ADMIN, `/api/v1/finance/payments/${PAYMENT}/refunds`, { amountPaise: 1_000, reason: failure, idempotencyKey: `failure-${failure}` });
        assert.equal(response.status, 500); assert.equal(state.offsets.length, 0); assert.equal(state.fee.amountPaidPaise, 10_000); assert.equal(state.audits.length, 0);
      }
    });
    await t.test("full refund reaches the canonical pending status and money bounds are strict", async () => {
      reset(); state.fee.totalPaise = 10_000;
      const full = await request(Role.SUPER_ADMIN, `/api/v1/finance/payments/${PAYMENT}/refunds`, { amountPaise: 10_000, reason: "Full refund", idempotencyKey: "full-refund" });
      assert.equal(full.status, 201); assert.equal(full.payload.created, true); assert.equal(full.payload.data.effectiveAmountPaidPaise, 0); assert.equal(full.payload.data.currentFeeStatus, FeeStatus.PENDING); assert.equal(state.fee.amountPaidPaise, 0); assert.equal(state.fee.status, FeeStatus.PENDING);
      for (const amount of [0, -1, 1.5, 2_147_483_648]) {
        reset();
        const response = await request(Role.SUPER_ADMIN, `/api/v1/finance/payments/${PAYMENT}/refunds`, { amountPaise: amount, reason: "Invalid amount", idempotencyKey: `invalid-${String(amount)}` });
        assert.equal(response.status, 422);
      }
    });
    await t.test("non-finance roles are rejected and detail/list routes stay tenant-scoped", async () => {
      reset();
      const denied = await request(Role.STUDENT, `/api/v1/finance/payments/${PAYMENT}/refunds`, { amountPaise: 1_000, reason: "Denied", idempotencyKey: "student-1" });
      assert.equal(denied.status, 403);
      assignedBranches = [];
      const list = await request(Role.ACCOUNTANT, "/api/v1/finance/payment-offsets");
      assert.equal(list.status, 200); assert.deepEqual(list.payload.data, []);
    });
    await t.test("cross-tenant payment and offset detail lookups return not found", async () => {
      reset();
      state.payment.organizationId = "other-org";
      state.fee.organizationId = "other-org";
      const payment = await request(Role.SUPER_ADMIN, `/api/v1/finance/payments/${PAYMENT}/refunds`, { amountPaise: 1_000, reason: "Cross tenant", idempotencyKey: "cross-tenant" });
      assert.equal(payment.status, 404);
      reset();
      seedOffset({ organizationId: "other-org" });
      const detail = await request(Role.SUPER_ADMIN, "/api/v1/finance/payment-offsets/offset-seeded");
      assert.equal(detail.status, 404);
    });
    await t.test("P2002 recovery returns the existing intent or an explicit conflict", async () => {
      reset(); seedOffset({ amountPaise: 1_000, reason: "Race", idempotencyKey: "race-key", reference: "RACE" }); forceP2002 = true;
      const same = await request(Role.SUPER_ADMIN, `/api/v1/finance/payments/${PAYMENT}/refunds`, { amountPaise: 1_000, reason: "Race", idempotencyKey: "race-key", reference: "RACE" });
      assert.equal(same.status, 200); assert.equal(same.payload.created, false);
      const conflict = await request(Role.SUPER_ADMIN, `/api/v1/finance/payments/${PAYMENT}/refunds`, { amountPaise: 1_000, reason: "Different", idempotencyKey: "race-key", reference: "RACE" });
      assert.equal(conflict.status, 409); assert.equal(conflict.payload.error.code, "PAYMENT_OFFSET_IDEMPOTENCY_CONFLICT");
    });
    await t.test("legacy and Batch 2 generated-source Fees both support offsets", async () => {
      reset();
      const legacy = await request(Role.SUPER_ADMIN, `/api/v1/finance/payments/${PAYMENT}/refunds`, { amountPaise: 500, reason: "Legacy", idempotencyKey: "legacy" });
      assert.equal(legacy.status, 201);
      reset();
      state.fee.studentFeeAssignmentId = "assignment-batch2";
      state.fee.feePlanComponentId = "component-batch2";
      const generated = await request(Role.SUPER_ADMIN, `/api/v1/finance/payments/${PAYMENT}/refunds`, { amountPaise: 500, reason: "Generated", idempotencyKey: "generated" });
      assert.equal(generated.status, 201);
    });
  } finally { server.close(); patchers.forEach(restore => restore()); }
});
