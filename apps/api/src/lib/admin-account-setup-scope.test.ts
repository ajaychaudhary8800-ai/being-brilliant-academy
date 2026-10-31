import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Role } from "@prisma/client";
import { AppError } from "./http.js";
import { assertCanIssueAccountSetup } from "./user-administration-policy.js";

test("Branch Admin cannot issue credential-bearing setup tokens to administrator accounts", () => {
  for (const role of [Role.SUPER_ADMIN, Role.BRANCH_ADMIN, Role.ACCOUNTANT]) {
    assert.throws(() => assertCanIssueAccountSetup(Role.BRANCH_ADMIN, role),
      (error: unknown) => error instanceof AppError && error.status === 403 && error.code === "ADMIN_ACCOUNT_PROTECTED");
  }
});

test("Branch Admin may issue account setup only to ordinary branch-visible profiles", () => {
  for (const role of [Role.STUDENT, Role.TEACHER, Role.PARENT, Role.EMPLOYEE]) {
    assert.doesNotThrow(() => assertCanIssueAccountSetup(Role.BRANCH_ADMIN, role));
  }
  assert.doesNotThrow(() => assertCanIssueAccountSetup(Role.SUPER_ADMIN, Role.BRANCH_ADMIN));
  assert.doesNotThrow(() => assertCanIssueAccountSetup(Role.SUPER_ADMIN, Role.SUPER_ADMIN));
});

test("setup-email endpoint applies target-role guard BEFORE any setup token/email write", async () => {
  const source = await readFile(new URL("../routes/admin-users.ts", import.meta.url), "utf8");
  const start = source.indexOf('router.post("/users/:id/setup-email"');
  const end = source.indexOf('router.put("/users/:id/accountant-branches"', start);
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end);
  const auth = block.indexOf("assertCanIssueAccountSetup(req.auth!.role, target.role)");
  const sideEffect = block.indexOf("issueAccountSetup({");
  assert.ok(auth >= 0 && sideEffect > auth);
});
