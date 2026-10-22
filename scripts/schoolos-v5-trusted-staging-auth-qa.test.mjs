import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const target = fileURLToPath(new URL("./schoolos-v5-trusted-staging-auth-qa.mjs", import.meta.url));
const sentinel = "NeverLeakThisPassword2026!";

function run(env) {
  return spawnSync(process.execPath, [target], {
    input: sentinel,
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf8",
    timeout: 10_000,
  });
}

test("trusted authenticated QA rejects GitHub Actions even with explicit approval", () => {
  const output = run({
    CI: "true",
    GITHUB_ACTIONS: "true",
    SCHOOLOS_V5_QA_TRUSTED_RUN: "OWNER_APPROVED_LOCAL_ONLY",
  });
  assert.notEqual(output.status, 0);
  assert.match(output.stderr, /prohibited inside GitHub Actions/);
  assert.ok(!output.stderr.includes(sentinel));
  assert.ok(!output.stdout.includes(sentinel));
});

test("trusted authenticated QA refuses missing human-operator authorization", () => {
  const output = run({});
  assert.notEqual(output.status, 0);
  assert.match(output.stderr, /owner-approved local execution/);
  assert.ok(!output.stderr.includes(sentinel));
});
