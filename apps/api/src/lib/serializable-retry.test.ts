import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "./http.js";
import { retrySerializableWrite } from "./serializable-retry.js";

const p2034 = () => Object.assign(new Error("conflict"), { code: "P2034" });

test("serialized branch provisioning retries transient P2034 and returns the committed result", async () => {
  let calls = 0;
  const result = await retrySerializableWrite(async () => {
    calls++;
    if (calls <= 2) throw p2034();
    return { branchId: "b", managerId: "m" };
  });
  assert.equal(calls, 3);
  assert.deepEqual(result, { branchId: "b", managerId: "m" });
});

test("serialized branch provisioning fails closed with an HTTP 409 after bounded retries", async () => {
  let calls = 0;
  await assert.rejects(
    () => retrySerializableWrite(async () => { calls++; throw p2034(); }, { conflictCode: "BRANCH_PROVISIONING_CONFLICT" }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "BRANCH_PROVISIONING_CONFLICT");
      return true;
    },
  );
  assert.equal(calls, 3);
});

test("non-retryable errors are thrown immediately without repeating provisioning", async () => {
  let calls = 0;
  const conflict = Object.assign(new Error("unique violation"), { code: "P2002" });
  await assert.rejects(
    () => retrySerializableWrite(async () => { calls++; throw conflict; }),
    error => error === conflict,
  );
  assert.equal(calls, 1);
});

test("invalid retry limits are rejected before any database changes", async () => {
  let calls = 0;
  await assert.rejects(
    () => retrySerializableWrite(async () => { calls++; return "no"; }, { attempts: 6 }),
    /attempts must be between 1 and 5/,
  );
  assert.equal(calls, 0);
});

const rawConflict = (code: string) => Object.assign(new Error("Raw query failed"), {
  code: "P2010", meta: { code, message: "non-sensitive PostgreSQL error" },
});

test("raw-query PostgreSQL 40001 serialization conflicts are retried safely", async () => {
  let calls = 0;
  const result = await retrySerializableWrite(async () => {
    calls++;
    if (calls === 1) throw rawConflict("40001");
    return { appointed: true };
  });
  assert.equal(calls, 2);
  assert.deepEqual(result, { appointed: true });
});

test("raw-query PostgreSQL 40P01 deadlock conflicts fail closed after bounded retries", async () => {
  let calls = 0;
  await assert.rejects(
    () => retrySerializableWrite(async () => { calls++; throw rawConflict("40P01"); }, {
      attempts: 2, conflictCode: "BRANCH_MANAGER_APPOINTMENT_CONFLICT",
    }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "BRANCH_MANAGER_APPOINTMENT_CONFLICT");
      return true;
    },
  );
  assert.equal(calls, 2);
});

test("non-serialization raw SQL errors are not retried", async () => {
  let calls = 0;
  const badSql = rawConflict("42P01");
  await assert.rejects(
    () => retrySerializableWrite(async () => { calls++; throw badSql; }),
    error => error === badSql,
  );
  assert.equal(calls, 1);
});
