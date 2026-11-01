import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "schoolos-v5-vault-offline-aesgcm.mjs");

test("AES-256-GCM CDV1 synthetic self-test, digest and tamper veto", () => {
  const x = spawnSync(process.execPath, [script, "--synthetic-self-test"], {
    encoding: "utf8",
    timeout: 10_000,
    env: {NODE_ENV: "test"},
  });
  assert.equal(x.status, 0);
  assert.equal(x.stderr, "");
  assert.match(x.stdout, /VAULT_OFFLINE_CRYPTO_SYNTHETIC=PASS/);
  assert.match(x.stdout, /VAULT_OFFLINE_TAMPER_AND_WRONG_KEY_VETO=PASS/);
});

test("unknown mode fails without error detail or user-data echoes", () => {
  const x = spawnSync(process.execPath, [script, "SENSITIVE-ARGUMENT"], {
    encoding: "utf8", timeout: 10_000,
  });
  assert.equal(x.status, 2);
  assert.equal(x.stdout.trim(),
    "VAULT_OFFLINE_GCM_TAG_AND_CONTENT_DIGEST=CHECK_REQUIRED");
  assert.doesNotMatch(x.stdout + x.stderr, /SENSITIVE-ARGUMENT/);
});

test("private mode forbids non-Windows CI and never prints input", () => {
  if (process.platform === "win32") return;
  const x = spawnSync(process.execPath, [script, "--owner-private-stdin"], {
    input: '{"cipherHex":"SENSITIVE-CIPHERTEXT"}',
    encoding: "utf8", timeout: 10_000,
  });
  assert.equal(x.status, 2);
  assert.equal(x.stdout.trim(),
    "VAULT_OFFLINE_GCM_TAG_AND_CONTENT_DIGEST=CHECK_REQUIRED");
  assert.doesNotMatch(x.stdout + x.stderr, /SENSITIVE-CIPHERTEXT/);
});
