import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { submitPasswordReset, validateResetPassword } from "./reset-password";

test("password validation enforces the existing strong account policy", () => {
  assert.deepEqual(validateResetPassword("short", "short"), { valid: false, message: "Use at least 10 characters." });
  assert.deepEqual(validateResetPassword("lowercase123", "lowercase123"), { valid: false, message: "Include at least one uppercase letter." });
  assert.deepEqual(validateResetPassword("UPPERCASE123", "UPPERCASE123"), { valid: false, message: "Include at least one lowercase letter." });
  assert.deepEqual(validateResetPassword("NoNumbersHere", "NoNumbersHere"), { valid: false, message: "Include at least one number." });
  assert.deepEqual(validateResetPassword("StrongPass1", "DifferentPass1"), { valid: false, message: "Passwords do not match." });
  assert.deepEqual(validateResetPassword("StrongPass1", "StrongPass1"), { valid: true });
});

test("reset submission uses the existing endpoint and exact token/password contract", async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  await submitPasswordReset(async (url, init) => {
    request = { url: String(url), init };
    return new Response(null, { status: 204 });
  }, "https://example.test/api/v1", "synthetic-reset-token-12345", "StrongPass1");
  assert.equal(request?.url, "https://example.test/api/v1/auth/reset-password");
  assert.equal(request?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(request?.init?.body)), { token: "synthetic-reset-token-12345", password: "StrongPass1" });
});

test("missing, invalid, expired, used, and network failures remain controlled", async () => {
  await assert.rejects(() => submitPasswordReset(fetch, "https://example.test/api/v1", "", "StrongPass1"), /missing or invalid/);
  const rejected = async () => new Response(JSON.stringify({ error: { code: "INVALID_RESET_TOKEN", message: "Internal detail" } }), { status: 400, headers: { "Content-Type": "application/json" } });
  await assert.rejects(() => submitPasswordReset(rejected, "https://example.test/api/v1", "synthetic-reset-token-12345", "StrongPass1"), /invalid, expired, or has already been used/);
  await assert.rejects(() => submitPasswordReset(async () => { throw new Error("network detail"); }, "https://example.test/api/v1", "synthetic-reset-token-12345", "StrongPass1"), /Unable to reach the service/);
});

test("the page keeps the raw token out of browser persistence and removes it from the address bar", () => {
  const source = readFileSync(new URL("../app/reset-password/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie|console\./);
  assert.match(source, /history\.replaceState/);
});

test("public registration presents the established strong password policy", () => {
  const source = readFileSync(new URL("../app/register/page.tsx", import.meta.url), "utf8");
  assert.match(source, /minLength=\{10\}/);
  assert.match(source, /maxLength=\{128\}/);
  assert.match(source, /uppercase and lowercase letters and at least one number/);
});
