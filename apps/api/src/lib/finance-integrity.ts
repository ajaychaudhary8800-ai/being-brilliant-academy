import { FeeStatus, JournalStatus, Role } from "@prisma/client";
import { AppError } from "./http.js";

export type PaidFeeIdentity = {
  studentId: string;
  branchId: string;
  courseId: string | null;
  batchId: string | null;
  feeHead: string;
  totalPaise: number;
  dueDate: Date;
};

export type PaidFeeIdentityUpdate = Partial<Omit<PaidFeeIdentity, "dueDate">> & { dueDate?: Date };

export const paidFeeIdentityFields = [
  "studentId",
  "branchId",
  "courseId",
  "batchId",
  "feeHead",
  "totalPaise",
  "dueDate",
] as const;

export function assertPaidFeeIdentityUnchanged(
  current: PaidFeeIdentity,
  update: PaidFeeIdentityUpdate,
  paymentCount: number,
) {
  if (paymentCount === 0) return;
  const changed = paidFeeIdentityFields.filter(field => {
    const next = update[field];
    if (next === undefined) return false;
    if (field === "dueDate") return (next as Date).getTime() !== current.dueDate.getTime();
    return next !== current[field];
  });
  if (changed.length) {
    throw new AppError(409, "PAID_FEE_IDENTITY_LOCKED", "A fee with recorded payments cannot change its financial identity");
  }
}

export function assertRelatedBranch(entity: string, expectedBranchId: string, actualBranchId: string | null | undefined) {
  if (!actualBranchId || actualBranchId !== expectedBranchId) {
    throw new AppError(422, "FINANCE_BRANCH_MISMATCH", `${entity} must belong to the transaction branch`);
  }
}

export function assertFinanceBranchAccess(role: Role, assignedBranchIds: readonly string[], targetBranchId: string) {
  if (role === Role.BRANCH_ADMIN && !assignedBranchIds.includes(targetBranchId)) {
    throw new AppError(403, "BRANCH_FORBIDDEN", "Branch access denied");
  }
}

export function canReadFinanceMasterData(role: Role, assignedBranchIds: readonly string[]) {
  return role !== Role.BRANCH_ADMIN || assignedBranchIds.length > 0;
}

export function assertSystemAccountCreationAllowed(role: Role, isSystem: boolean) {
  if (role === Role.BRANCH_ADMIN && isSystem) {
    throw new AppError(403, "SYSTEM_ACCOUNT_FORBIDDEN", "Only super administrators may create system accounts");
  }
}

export function assertVoucherCanTransition(status: JournalStatus, financialYearLocked: boolean) {
  if (status !== JournalStatus.DRAFT || financialYearLocked) {
    throw new AppError(409, "VOUCHER_LOCKED", "Only draft vouchers in open years can be transitioned");
  }
}

export function assertVoucherTransitionApplied(updatedCount: number) {
  if (updatedCount !== 1) {
    throw new AppError(409, "VOUCHER_TRANSITION_CONFLICT", "The voucher changed; reload and try again");
  }
}

export function assertFeeCanBeDeleted(amountPaidPaise: number, paymentCount: number, adjustmentCount: number) {
  if (amountPaidPaise > 0 || paymentCount > 0) {
    throw new AppError(409, "PAID_FEE_PROTECTED", "Paid or partially paid fee records cannot be deleted");
  }
  if (adjustmentCount > 0) {
    throw new AppError(409, "ADJUSTED_FEE_PROTECTED", "Fee records with financial adjustments cannot be deleted");
  }
}

const forbiddenAuditKeys = new Set([
  "password", "passwordhash", "passworddigest", "passphrase",
  "token", "accesstoken", "refreshtoken", "resettoken", "setuptoken", "sessiontoken",
  "authorization", "authorizationheader", "credential", "credentials", "secret", "providersecret", "apikey",
  "bankaccount", "accountnumber", "routingnumber", "routingcode", "ifsc", "iban", "swift", "bic",
  "pan", "gstin", "email", "phone", "attachment", "attachmentdata", "attachmentcontent", "attachmentbinary",
  "filedata", "filecontent", "binary", "blob", "base64", "privatekey",
]);

function normalizedAuditKey(key: string) {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isSensitiveAuditKey(key: string) {
  const normalized = normalizedAuditKey(key);
  return forbiddenAuditKeys.has(normalized)
    || normalized.startsWith("password")
    || normalized.endsWith("token")
    || normalized.endsWith("credential")
    || normalized.endsWith("credentials")
    || normalized.endsWith("secret")
    || normalized.endsWith("apikey");
}

export function safeFinanceAuditMetadata<T extends object>(metadata: T): T {
  const sanitize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sanitize);
    if (!value || typeof value !== "object" || value instanceof Date) return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !isSensitiveAuditKey(key))
        .map(([key, child]) => [key, sanitize(child)]),
    );
  };
  return sanitize(metadata) as T;
}

export function rejectUnverifiedParentPayment(): never {
  throw new AppError(409, "VERIFIED_PAYMENT_REQUIRED", "Online payment is unavailable until verified provider settlement is configured. Contact the institution for payment options.");
}

export function feeStatus(total: number, discount: number, fine: number, paid: number, due: Date, now = new Date()) {
  const net = total - discount + fine;
  if (paid >= net) return FeeStatus.PAID;
  if (paid > 0) return FeeStatus.PARTIAL;
  const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return dueDay < today ? FeeStatus.OVERDUE : FeeStatus.PENDING;
}

export function assertPaymentWithinAuthoritativeBalance(total: number, discount: number, fine: number, paid: number, amount: number) {
  const balance = total - discount + fine - paid;
  if (amount > balance) throw new AppError(422, "PAYMENT_EXCEEDS_BALANCE", "Payment cannot exceed balance");
  return balance;
}

export function isSerializableConflict(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2034");
}
