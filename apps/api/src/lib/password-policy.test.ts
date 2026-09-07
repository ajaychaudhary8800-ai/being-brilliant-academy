import assert from "node:assert/strict";
import test from "node:test";
import { securePasswordSchema } from "./password-policy.js";

test("password setup and account changes share the strong password policy", () => {
  for (const password of ["Short1A", "lowercase123", "UPPERCASE123", "NoNumbersHere"]) assert.equal(securePasswordSchema.safeParse(password).success, false);
  assert.equal(securePasswordSchema.safeParse("StrongPass1").success, true);
  assert.equal(securePasswordSchema.safeParse(`${"A".repeat(128)}a1`).success, false);
});
