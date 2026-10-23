import test from "node:test";
import assert from "node:assert/strict";
import { DIAGNOSTIC_HOST, sanitizedErrorCode, summarizeDns } from "./schoolos-v5-network-diagnostics.mjs";

test("network diagnostics are pinned to the exact V5 staging domain", () => {
  assert.equal(DIAGNOSTIC_HOST, "v5-staging.beingbrilliantedu.com");
});

test("DNS summary counts address families without exposing returned IP values", () => {
  const output = summarizeDns([
    { family: 4, address: "203.0.113.77" },
    { family: 6, address: "2001:db8::1" },
    { family: 4, address: "203.0.113.78" },
  ]);
  assert.deepEqual(output, { ipv4: 2, ipv6: 1 });
  assert.doesNotMatch(JSON.stringify(output), /203\.0\.113|2001:db8/);
});

test("transport error classification emits only safe machine codes", () => {
  assert.equal(sanitizedErrorCode({ cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }), "UND_ERR_CONNECT_TIMEOUT");
  assert.equal(sanitizedErrorCode({ code: "ETIMEDOUT" }), "ETIMEDOUT");
  assert.equal(sanitizedErrorCode({ code: "password=do-not-leak" }), "UNCLASSIFIED");
  assert.equal(sanitizedErrorCode(new Error("token secret")), "UNCLASSIFIED");
});
