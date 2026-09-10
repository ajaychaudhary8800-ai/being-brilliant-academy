import assert from "node:assert/strict";
import test from "node:test";
import { FeeStatus, JournalStatus, Role } from "@prisma/client";
import { requireRequestedBranch } from "./branch-policy.js";
import {
  assertFeeCanBeDeleted,
  adjustedFeeAmounts,
  assertFinanceBranchAccess,
  assertPaidFeeIdentityUnchanged,
  assertPaymentWithinAuthoritativeBalance,
  assertRelatedBranch,
  assertSystemAccountCreationAllowed,
  assertVoucherCanTransition,
  assertVoucherTransitionApplied,
  canReadFinanceMasterData,
  feeStatus,
  isSerializableConflict,
  rejectUnverifiedParentPayment,
  safeFinanceAuditMetadata,
} from "./finance-integrity.js";

const fee = {
  studentId: "student-a",
  branchId: "branch-a",
  courseId: "course-a",
  batchId: "batch-a",
  feeHead: "Tuition",
  totalPaise: 100_00,
  discountPaise: 0,
  finePaise: 0,
  dueDate: new Date("2026-09-01T00:00:00.000Z"),
};

test("branch administrators cannot override their assigned finance branches", () => {
  assert.deepEqual(requireRequestedBranch(Role.BRANCH_ADMIN, ["branch-a"], "branch-a"), { branchId: "branch-a" });
  assert.throws(
    () => requireRequestedBranch(Role.BRANCH_ADMIN, ["branch-a"], "branch-b"),
    (error: unknown) => (error as { code?: string }).code === "BRANCH_FORBIDDEN",
  );
  assert.deepEqual(requireRequestedBranch(Role.BRANCH_ADMIN, []), { branchId: { in: [] } });
  assert.deepEqual(requireRequestedBranch(Role.SUPER_ADMIN, [], "branch-b"), { branchId: "branch-b" });
});

test("accountants are always limited to assigned branches, including zero-branch users", () => {
  assert.deepEqual(requireRequestedBranch(Role.ACCOUNTANT, ["branch-a"], "branch-a"), { branchId: "branch-a" });
  assert.deepEqual(requireRequestedBranch(Role.ACCOUNTANT, []), { branchId: { in: [] } });
  assert.throws(() => requireRequestedBranch(Role.ACCOUNTANT, ["branch-a"], "branch-b"), cause => (cause as { code?: string }).code === "BRANCH_FORBIDDEN");
  assert.doesNotThrow(() => assertFinanceBranchAccess(Role.ACCOUNTANT, ["branch-a"], "branch-a"));
  assert.throws(() => assertFinanceBranchAccess(Role.ACCOUNTANT, [], "branch-a"), cause => (cause as { code?: string }).code === "BRANCH_FORBIDDEN");
});

test("paid fees lock identity while unpaid fees remain editable", () => {
  assert.doesNotThrow(() => assertPaidFeeIdentityUnchanged(fee, { studentId: "student-b", feeHead: "Transport" }, 0));
  for (const update of [
    { studentId: "student-b" },
    { branchId: "branch-b" },
    { courseId: "course-b" },
    { batchId: "batch-b" },
    { feeHead: "Transport" },
    { totalPaise: 200_00 },
    { discountPaise: 10_00 },
    { finePaise: 5_00 },
    { dueDate: new Date("2026-10-01T00:00:00.000Z") },
  ]) {
    assert.throws(() => assertPaidFeeIdentityUnchanged(fee, update, 1), (error: unknown) => (error as { code?: string }).code === "PAID_FEE_IDENTITY_LOCKED");
  }
  assert.doesNotThrow(() => assertPaidFeeIdentityUnchanged(fee, { feeHead: fee.feeHead }, 1));
});

test("finance relationships must remain in the transaction branch", () => {
  assert.doesNotThrow(() => assertRelatedBranch("Vendor", "branch-a", "branch-a"));
  assert.throws(
    () => assertRelatedBranch("Vendor", "branch-a", "branch-b"),
    (error: unknown) => (error as { code?: string }).code === "FINANCE_BRANCH_MISMATCH",
  );
});

test("ID-based finance access is limited to assigned branches", () => {
  assert.doesNotThrow(() => assertFinanceBranchAccess(Role.BRANCH_ADMIN, ["branch-a"], "branch-a"));
  assert.throws(
    () => assertFinanceBranchAccess(Role.BRANCH_ADMIN, ["branch-a"], "branch-b"),
    (error: unknown) => (error as { code?: string }).code === "BRANCH_FORBIDDEN",
  );
  assert.throws(
    () => assertFinanceBranchAccess(Role.BRANCH_ADMIN, [], "branch-a"),
    (error: unknown) => (error as { code?: string }).code === "BRANCH_FORBIDDEN",
  );
  assert.doesNotThrow(() => assertFinanceBranchAccess(Role.SUPER_ADMIN, [], "branch-b"));
});

test("finance master data requires an assigned branch for branch administrators", () => {
  assert.equal(canReadFinanceMasterData(Role.BRANCH_ADMIN, []), false);
  assert.equal(canReadFinanceMasterData(Role.BRANCH_ADMIN, ["branch-a"]), true);
  assert.equal(canReadFinanceMasterData(Role.SUPER_ADMIN, []), true);
  assert.equal(canReadFinanceMasterData(Role.ACCOUNTANT, ["branch-a"]), false);
});

test("only super administrators may create system ledger accounts", () => {
  assert.doesNotThrow(() => assertSystemAccountCreationAllowed(Role.BRANCH_ADMIN, false));
  assert.throws(
    () => assertSystemAccountCreationAllowed(Role.BRANCH_ADMIN, true),
    (error: unknown) => (error as { code?: string }).code === "SYSTEM_ACCOUNT_FORBIDDEN",
  );
  assert.doesNotThrow(() => assertSystemAccountCreationAllowed(Role.SUPER_ADMIN, true));
  assert.throws(() => assertSystemAccountCreationAllowed(Role.ACCOUNTANT, true), cause => (cause as { code?: string }).code === "SYSTEM_ACCOUNT_FORBIDDEN");
});

test("fee status is derived from authoritative totals", () => {
  const due = new Date("2026-09-01T00:00:00.000Z");
  const now = new Date("2026-09-08T00:00:00.000Z");
  assert.equal(feeStatus(100, 10, 5, 95, due, now), FeeStatus.PAID);
  assert.equal(feeStatus(100, 10, 5, 20, due, now), FeeStatus.PARTIAL);
  assert.equal(feeStatus(100, 10, 5, 0, due, now), FeeStatus.OVERDUE);
});

test("authoritative payment totals reject sequential or concurrent over-collection", () => {
  assert.equal(assertPaymentWithinAuthoritativeBalance(10_000, 0, 0, 6_000, 4_000), 4_000);
  assert.throws(
    () => assertPaymentWithinAuthoritativeBalance(10_000, 0, 0, 6_000, 5_000),
    (error: unknown) => (error as { code?: string }).code === "PAYMENT_EXCEEDS_BALANCE",
  );
  assert.throws(
    () => assertPaymentWithinAuthoritativeBalance(10_000, 0, 0, 10_000, 1),
    (error: unknown) => (error as { code?: string }).code === "PAYMENT_EXCEEDS_BALANCE",
  );
});

test("audited fee adjustments derive operational totals without rewriting the original amount", () => {
  const current = { totalPaise: 10_000, discountPaise: 500, finePaise: 100, amountPaidPaise: 4_000 };
  assert.deepEqual(adjustedFeeAmounts(current, "DISCOUNT", 500), { discountPaise: 1_000, finePaise: 100 });
  assert.deepEqual(adjustedFeeAmounts(current, "SCHOLARSHIP", 500), { discountPaise: 1_000, finePaise: 100 });
  assert.deepEqual(adjustedFeeAmounts(current, "FINE", 500), { discountPaise: 500, finePaise: 600 });
  assert.deepEqual(adjustedFeeAmounts(current, "REFUND", 500), { discountPaise: 500, finePaise: 100 });
  assert.throws(() => adjustedFeeAmounts(current, "DISCOUNT", 9_501), cause => (cause as { code?: string }).code === "INVALID_FEE_ADJUSTMENT");
  assert.throws(() => adjustedFeeAmounts({ ...current, amountPaidPaise: 9_500 }, "DISCOUNT", 200), cause => (cause as { code?: string }).code === "ADJUSTMENT_BELOW_PAID");
});

test("unverified parent payment declarations are rejected", () => {
  assert.throws(rejectUnverifiedParentPayment, (error: unknown) => (error as { code?: string }).code === "VERIFIED_PAYMENT_REQUIRED");
});

test("finance audit metadata recursively drops secrets without aborting harmless audit data", () => {
  const metadata = {
    branchId: "branch-a",
    amountPaise: 1_000,
    email: "finance@example.test",
    phone: "+910000000000",
    passwordHash: "hash",
    nested: {
      provider_secret: "secret",
      authorization: "Bearer value",
      harmless: "kept",
      rows: [{ apiKey: "key", label: "kept-row" }, { account_number: "123456", count: 2 }],
    },
  };
  assert.deepEqual(safeFinanceAuditMetadata(metadata), {
    branchId: "branch-a",
    amountPaise: 1_000,
    nested: { harmless: "kept", rows: [{ label: "kept-row" }, { count: 2 }] },
  });
  assert.deepEqual(safeFinanceAuditMetadata({ bankAccountId: "bank-id", attachmentContent: "bytes", reference: "ref" }), { bankAccountId: "bank-id", reference: "ref" });
});

test("fee deletion preserves payment and adjustment history", () => {
  assert.doesNotThrow(() => assertFeeCanBeDeleted(0, 0, 0));
  assert.throws(() => assertFeeCanBeDeleted(1, 0, 0), (error: unknown) => (error as { code?: string }).code === "PAID_FEE_PROTECTED");
  assert.throws(() => assertFeeCanBeDeleted(0, 1, 0), (error: unknown) => (error as { code?: string }).code === "PAID_FEE_PROTECTED");
  assert.throws(() => assertFeeCanBeDeleted(0, 0, 1), (error: unknown) => (error as { code?: string }).code === "ADJUSTED_FEE_PROTECTED");
});

test("voucher transitions require a draft in an open year and exactly one conditional update", () => {
  assert.doesNotThrow(() => assertVoucherCanTransition(JournalStatus.DRAFT, false));
  assert.throws(() => assertVoucherCanTransition(JournalStatus.POSTED, false), (error: unknown) => (error as { code?: string }).code === "VOUCHER_LOCKED");
  assert.throws(() => assertVoucherCanTransition(JournalStatus.DRAFT, true), (error: unknown) => (error as { code?: string }).code === "VOUCHER_LOCKED");
  assert.doesNotThrow(() => assertVoucherTransitionApplied(1));
  assert.throws(() => assertVoucherTransitionApplied(0), (error: unknown) => (error as { code?: string }).code === "VOUCHER_TRANSITION_CONFLICT");
});

test("serializable conflicts are recognizable without exposing internal details", () => {
  assert.equal(isSerializableConflict({ code: "P2034" }), true);
  assert.equal(isSerializableConflict({ code: "P2002" }), false);
});
