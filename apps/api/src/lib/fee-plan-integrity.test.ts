import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "./http.js";
import { assertDueDatesWithinSession, dateOnly, normalizeFeeHead, planTotalPaise, validatePlanStructure, type FeePlanInput } from "./fee-plan-integrity.js";

const plan = (overrides: Partial<FeePlanInput> = {}): FeePlanInput => ({
  code: "UG-2026",
  name: "Undergraduate 2026",
  academicSessionId: "session-1",
  branchId: null,
  courseId: null,
  batchId: null,
  installments: [{ sequence: 1, title: "First installment", dueDate: new Date("2026-06-01T00:00:00.000Z"), components: [{ feeHead: " Tuition  ", amountPaise: 12_500, position: 0 }] }],
  ...overrides,
});

test("fee-plan component normalization and totals are deterministic", () => {
  assert.equal(normalizeFeeHead("  Tuition   Fee "), "tuition fee");
  assert.equal(planTotalPaise(plan().installments), 12_500);
  assert.doesNotThrow(() => validatePlanStructure(plan(), true));
});

test("fee-plan structure rejects duplicate sequences, normalized heads, and invalid amounts", () => {
  assert.throws(() => validatePlanStructure(plan({ installments: [
    { sequence: 1, title: "One", dueDate: new Date("2026-06-01"), components: [] },
    { sequence: 1, title: "Again", dueDate: new Date("2026-07-01"), components: [] },
  ] })), (error: unknown) => error instanceof AppError && error.code === "DUPLICATE_INSTALLMENT_SEQUENCE");
  assert.throws(() => validatePlanStructure(plan({ installments: [{ sequence: 1, title: "One", dueDate: new Date("2026-06-01"), components: [{ feeHead: "Tuition", amountPaise: 1 }, { feeHead: " tuition ", amountPaise: 2 }] }] })), (error: unknown) => error instanceof AppError && error.code === "DUPLICATE_FEE_HEAD");
  assert.throws(() => validatePlanStructure(plan({ installments: [{ sequence: 1, title: "One", dueDate: new Date("2026-06-01"), components: [{ feeHead: "Tuition", amountPaise: 0 }] }] })), /positive integer/);
  assert.throws(() => validatePlanStructure(plan({ installments: [{ sequence: 1, title: "One", dueDate: new Date("2026-06-01"), components: [] }] }), true), (error: unknown) => error instanceof AppError && error.code === "INCOMPLETE_FEE_PLAN");
  assert.throws(() => validatePlanStructure(plan({ installments: [plan().installments[0], { sequence: 2, title: "Empty", dueDate: new Date("2026-07-01"), components: [] }] }), true), (error: unknown) => error instanceof AppError && error.code === "INCOMPLETE_FEE_PLAN");
});

test("fee-plan due dates are inclusive but cannot escape the academic session", () => {
  const starts = dateOnly(new Date("2026-04-01T12:00:00.000Z"));
  const ends = dateOnly(new Date("2027-03-31T12:00:00.000Z"));
  assert.doesNotThrow(() => assertDueDatesWithinSession(plan().installments, starts, ends));
  assert.throws(() => assertDueDatesWithinSession([{ ...plan().installments[0], dueDate: new Date("2027-04-01") }], starts, ends), (error: unknown) => error instanceof AppError && error.code === "INSTALLMENT_DATE_OUTSIDE_SESSION");
});
