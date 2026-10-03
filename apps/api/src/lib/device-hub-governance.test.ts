import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  connectorHealth,
  generateEdgeAgentToken,
  hashEdgeAgentToken,
  nextRetryState,
  retryBackoffMs,
  verifyDeviceEventSignature,
  verifyEdgeAgentToken,
} from "./device-hub-governance.js";

test("edge agent tokens persist only a timing-safe digest", () => {
  const token = generateEdgeAgentToken();
  const hash = hashEdgeAgentToken(token);
  assert.equal(hash.length, 64);
  assert.notEqual(token, hash);
  assert.equal(verifyEdgeAgentToken(token, hash), true);
  assert.equal(verifyEdgeAgentToken(token + "x", hash), false);
});

test("Ed25519 device signatures bind timestamp and source hash", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const timestamp = "1790744400000";
  const sourceHash = "a".repeat(64);
  const signature = crypto.sign(null, Buffer.from(`${timestamp}.${sourceHash}`), privateKey).toString("base64url");
  const result = verifyDeviceEventSignature({
    sourceHash,
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    timestampHeader: timestamp,
    signatureHeader: signature,
    now: new Date(Number(timestamp)),
  });
  assert.equal(result.ok, true);
  assert.equal(verifyDeviceEventSignature({
    sourceHash: "b".repeat(64),
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    timestampHeader: timestamp,
    signatureHeader: signature,
    now: new Date(Number(timestamp)),
  }).ok, false);
});

test("signed events outside replay window fail closed", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const timestamp = "1790744400000";
  const sourceHash = "c".repeat(64);
  const signature = crypto.sign(null, Buffer.from(`${timestamp}.${sourceHash}`), privateKey).toString("base64");
  const result = verifyDeviceEventSignature({
    sourceHash,
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    timestampHeader: timestamp,
    signatureHeader: signature,
    now: new Date(Number(timestamp) + 5 * 60_000 + 1),
  });
  assert.deepEqual(result, { ok: false, code: "SIGNATURE_TIMESTAMP_OUT_OF_WINDOW" });
});

test("retry backoff grows exponentially and dead-letters at max attempts", () => {
  assert.equal(retryBackoffMs(0), 5_000);
  assert.equal(retryBackoffMs(1), 10_000);
  const queued = nextRetryState({ attempts: 1, maxAttempts: 8, now: new Date("2026-09-30T06:00:00.000Z") });
  assert.equal(queued.status, "QUEUED");
  assert.equal(queued.attempts, 2);
  assert.equal(queued.nextAttemptAt?.toISOString(), "2026-09-30T06:00:10.000Z");
  const dead = nextRetryState({ attempts: 7, maxAttempts: 8 });
  assert.equal(dead.status, "DEAD_LETTER");
  assert.equal(dead.attempts, 8);
  assert.equal(dead.nextAttemptAt, null);
});

test("connector health requires ACTIVE, recent success and zero consecutive failures", () => {
  const now = new Date("2026-09-30T06:00:00.000Z");
  assert.equal(connectorHealth({ status: "ACTIVE", lastSuccessAt: new Date("2026-09-30T05:59:30.000Z"), now }).healthy, true);
  assert.equal(connectorHealth({ status: "ACTIVE", lastSuccessAt: new Date("2026-09-30T05:30:00.000Z"), now }).healthy, false);
  assert.equal(connectorHealth({ status: "ACTIVE", lastSuccessAt: now, consecutiveFailures: 1, now }).healthy, false);
});
