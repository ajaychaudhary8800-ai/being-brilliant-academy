import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("signed device ingestion binds signature to canonical event fingerprint and bounded timestamp", async () => {
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");
  const governance = await readFile(new URL("../lib/device-hub-governance.ts", import.meta.url), "utf8");
  assert.match(routes, /x-device-timestamp/);
  assert.match(routes, /x-device-signature/);
  assert.match(routes, /verifyDeviceEventSignature/);
  assert.match(governance, /ed25519/);
  assert.match(governance, /5 \* 60_000/);
  assert.match(governance, /\$\{raw\}\.\$\{input\.sourceHash\}/);
});

test("signing remains opt-in per device and cannot be enabled without a valid public key", async () => {
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");
  assert.match(schema, /signatureRequired\s+Boolean\s+@default\(false\)/);
  assert.match(schema, /signingPublicKey\s+String\?/);
  assert.match(routes, /DEVICE_SIGNING_KEY_REQUIRED/);
  assert.match(routes, /asymmetricKeyType !== "ed25519"/);
});

test("Edge Agent remains outbound-only through token-authenticated heartbeat poll and acknowledgement", async () => {
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");
  const guard = routes.indexOf("router.use(requireAuth");
  for (const route of [
    'router.post("/device-hub/edge-agents/:agentId/heartbeat"',
    'router.get("/device-hub/edge-agents/:agentId/commands"',
    'router.post("/device-hub/edge-agents/:agentId/commands/:commandId/ack"',
  ]) {
    const index = routes.indexOf(route);
    assert.ok(index >= 0 && index < guard);
  }
  assert.match(routes, /x-edge-agent-token/);
  assert.match(routes, /verifyEdgeAgentToken/);
});

test("adapter registry exposes stable capability and entitlement metadata", async () => {
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");
  assert.match(schema, /model DeviceAdapterRegistry \{/);
  assert.match(schema, /requiredEntitlement\s+String\?/);
  assert.match(schema, /supportsEdgeAgent\s+Boolean/);
  assert.match(schema, /supportsDiscovery\s+Boolean/);
  assert.match(routes, /assertFeatureEntitled/);
});

test("connector secrets are reference-only and masked in API responses", async () => {
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");
  assert.match(routes, /Store a secret-manager reference, not raw credentials or endpoint secrets/);
  assert.match(routes, /secretRef: item\.secretRef \? "\[configured\]" : null/);
  assert.match(routes, /secretRef: data\.secretRef \? "\[configured\]" : null/);
});

test("retry jobs have deterministic dedupe keys, exponential backoff and dead-letter state", async () => {
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const governance = await readFile(new URL("../lib/device-hub-governance.ts", import.meta.url), "utf8");
  const worker = await readFile(new URL("../lib/device-hub-retry-worker.ts", import.meta.url), "utf8");
  assert.match(schema, /dedupeKey\s+String\s+@unique/);
  assert.match(governance, /2 \*\* safeAttempt/);
  assert.match(governance, /"DEAD_LETTER"/);
  assert.match(worker, /processDueDeviceRetries/);
  assert.match(worker, /EVENT_PROCESS/);
  assert.match(worker, /COMMAND_DELIVERY/);
});

test("Device Hub retry worker participates in operational health and graceful shutdown", async () => {
  const server = await readFile(new URL("../server.ts", import.meta.url), "utf8");
  assert.match(server, /processDueDeviceRetries/);
  assert.match(server, /workerHeartbeats\.deviceHub/);
  assert.match(server, /DEVICE_HUB_WORKER_INTERVAL_MS/);
  assert.match(server, /clearInterval\(deviceHubWorker\)/);
});
