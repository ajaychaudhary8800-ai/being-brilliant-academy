import { AppError } from "./http.js";

export type FeePlanComponentInput = {
  feeHead: string;
  amountPaise: number;
  position?: number;
};

export type FeePlanInstallmentInput = {
  sequence: number;
  title: string;
  dueDate: Date;
  components: FeePlanComponentInput[];
};

export type FeePlanInput = {
  code: string;
  name: string;
  academicSessionId: string;
  branchId?: string | null;
  courseId?: string | null;
  batchId?: string | null;
  installments: FeePlanInstallmentInput[];
};

export function normalizeFeeHead(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-IN");
}

export function dateOnly(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function planTotalPaise(installments: readonly FeePlanInstallmentInput[]) {
  return installments.reduce((total, installment) => total + installment.components.reduce((sum, component) => sum + component.amountPaise, 0), 0);
}

export function validatePlanStructure(input: FeePlanInput, requireComplete = false) {
  const sequences = new Set<number>();
  for (const installment of input.installments) {
    if (!Number.isInteger(installment.sequence) || installment.sequence <= 0) throw new AppError(422, "INVALID_INSTALLMENT_SEQUENCE", "Installment sequence must be a positive integer");
    if (sequences.has(installment.sequence)) throw new AppError(422, "DUPLICATE_INSTALLMENT_SEQUENCE", "Installment sequence must be unique within a fee plan");
    sequences.add(installment.sequence);
    if (!installment.title.trim()) throw new AppError(422, "INVALID_INSTALLMENT_TITLE", "Installment title is required");
    const heads = new Set<string>();
    for (const component of installment.components) {
      const normalized = normalizeFeeHead(component.feeHead);
      if (!normalized) throw new AppError(422, "INVALID_FEE_HEAD", "Fee head is required");
      if (!Number.isSafeInteger(component.amountPaise) || component.amountPaise <= 0) throw new AppError(422, "INVALID_COMPONENT_AMOUNT", "Fee component amount must be a positive integer in paise");
      if (heads.has(normalized)) throw new AppError(422, "DUPLICATE_FEE_HEAD", "Fee heads must be unique within an installment");
      heads.add(normalized);
    }
  }
  if (requireComplete && (!input.installments.length || input.installments.some(item => !item.components.length) || planTotalPaise(input.installments) <= 0)) {
    throw new AppError(422, "INCOMPLETE_FEE_PLAN", "An active fee plan needs at least one installment and one positive fee component");
  }
}

export function assertDueDatesWithinSession(installments: readonly FeePlanInstallmentInput[], startsAt: Date, endsAt: Date) {
  const start = dateOnly(startsAt).getTime();
  const end = dateOnly(endsAt).getTime();
  for (const installment of installments) {
    const due = dateOnly(installment.dueDate).getTime();
    if (due < start || due > end) throw new AppError(422, "INSTALLMENT_DATE_OUTSIDE_SESSION", "Installment due dates must fall within the academic session");
  }
}
