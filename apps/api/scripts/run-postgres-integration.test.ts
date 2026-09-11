import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeTestDatabaseUrl, pnpmSpawnSpec } from "./run-postgres-integration.mjs";

test("PostgreSQL runner uses Node plus pnpm JavaScript entrypoint on Windows", () => {
  assert.deepEqual(pnpmSpawnSpec(["--version"], { platform: "win32", execPath: "C:\\node.exe", npmExecPath: "C:\\pnpm\\pnpm.cjs" }), {
    command: "C:\\node.exe",
    args: ["C:\\pnpm\\pnpm.cjs", "--version"],
  });
});

test("PostgreSQL runner keeps the pnpm executable fallback on Linux", () => {
  assert.deepEqual(pnpmSpawnSpec(["--version"], { platform: "linux", execPath: "/usr/bin/node", npmExecPath: undefined }), {
    command: "pnpm",
    args: ["--version"],
  });
});

test("Windows runner refuses to guess a pnpm path", () => {
  assert.throws(() => pnpmSpawnSpec([], { platform: "win32", npmExecPath: undefined }), /npm_execpath is unavailable/);
});

test("runner accepts only local clearly named test databases", () => {
  assert.equal(assertSafeTestDatabaseUrl("postgresql://localhost:55432/phase0_test"), "postgresql://localhost:55432/phase0_test");
  assert.throws(() => assertSafeTestDatabaseUrl("postgresql://localhost/production"), /clearly identifies a test database/);
  assert.throws(() => assertSafeTestDatabaseUrl("postgresql://db.example/phase0_test"), /local PostgreSQL URL/);
});
