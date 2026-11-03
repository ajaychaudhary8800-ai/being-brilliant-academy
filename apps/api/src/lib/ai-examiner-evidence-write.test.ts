import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { AppError } from "./http.js";
import { lockMutableEvidenceAnswerSheet } from "./ai-examiner-evidence-write.js";

const TENANT = "bba-evidence-test-tenant";
const SHEET = "cmvo2g6tc002aqr08aq1nv9gz";
type FakeState = { rows: number; finalizedAt: Date | null; present: boolean; calls: string[] };
function fakeTx(state: FakeState): Prisma.TransactionClient {
  return {
    $queryRaw: async (sql: TemplateStringsArray, ...parameters: unknown[]) => {
      state.calls.push("lock");
      assert.match(sql.join("?"), /ExaminationAnswerSheet.*organizationId.*FOR UPDATE/s);
      assert.deepEqual(parameters, [SHEET, TENANT]);
      return Array.from({ length: state.rows }, () => ({ id: SHEET }));
    },
    examinationAnswerSheet: {
      findFirst: async ({ where, select }: any) => {
        state.calls.push("read");
        assert.deepEqual(where, { id: SHEET, organizationId: TENANT });
        assert.deepEqual(select, { finalizedAt: true });
        return state.present ? { finalizedAt: state.finalizedAt } : null;
      },
    },
  } as unknown as Prisma.TransactionClient;
}
function state(overrides: Partial<FakeState> = {}): FakeState {
  return { rows: 1, finalizedAt: null, present: true, calls: [], ...overrides };
}
function hasCode(error: unknown, code: string) {
  return error instanceof AppError && error.code === code && error.status === (code === "ANSWER_SHEET_NOT_FOUND" ? 404 : 409);
}

test("AI evidence writes lock the exact tenant and sheet before reading unfinalized state", async () => {
  const s = state();
  await lockMutableEvidenceAnswerSheet(fakeTx(s), TENANT, SHEET);
  assert.deepEqual(s.calls, ["lock", "read"]);
});

test("AI evidence review fails closed when the sheet was finalized between authorization and the row lock", async () => {
  const s = state({ finalizedAt: new Date("2026-10-31T00:00:00Z") });
  await assert.rejects(lockMutableEvidenceAnswerSheet(fakeTx(s), TENANT, SHEET),
    error => hasCode(error, "AI_EXAMINER_EVIDENCE_FINALIZED"));
  assert.deepEqual(s.calls, ["lock", "read"]);
});

test("AI evidence write refuses missing tenant-bound row and incomplete row read", async () => {
  for (const s of [state({ rows: 0 }), state({ present: false }), state({ rows: 2 })]) {
    await assert.rejects(lockMutableEvidenceAnswerSheet(fakeTx(s), TENANT, SHEET),
      error => hasCode(error, "ANSWER_SHEET_NOT_FOUND"));
  }
});
