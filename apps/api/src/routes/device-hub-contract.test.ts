import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Device Hub is mounted under a scoped API path", async () => {
  const server = await readFile(new URL("../server.ts", import.meta.url), "utf8");
  assert.match(server, /import deviceHub from ".\/routes\/device-hub\.js"/);
  assert.match(server, /onlyPaths\(\["\/device-hub"\], deviceHub\)/);
});

test("hardware ingest route is declared before JWT/RBAC guards", async () => {
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");
  const ingest = routes.indexOf('router.post("/device-hub/ingest/:deviceId"');
  const guard = routes.indexOf("router.use(requireAuth, allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN))");
  assert.ok(ingest >= 0);
  assert.ok(guard > ingest);
});

test("device ingest requires per-device token and rejects disabled hardware", async () => {
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.post("/device-hub/ingest/:deviceId"');
  const end = routes.indexOf("router.use(requireAuth", start);
  const section = routes.slice(start, end);

  assert.match(section, /x-device-token/);
  assert.match(section, /verifyConnectedDeviceIngestToken/);
  assert.match(section, /DEVICE_INGEST_UNAUTHORIZED/);
  assert.match(section, /ConnectedDeviceStatus\.DISABLED/);
  assert.match(section, /ConnectedDeviceStatus\.RETIRED/);
});

test("device ingest is idempotent and tenant identity comes from the device record", async () => {
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.post("/device-hub/ingest/:deviceId"');
  const end = routes.indexOf("router.use(requireAuth", start);
  const section = routes.slice(start, end);

  assert.match(section, /connectedDeviceSourceHash/);
  assert.match(section, /externalEventId/);
  assert.match(section, /organizationId: device\.organizationId/);
  assert.match(section, /error\?\.code === "P2002"/);
  assert.match(section, /duplicate: true/);
});

test("management routes use tenant and branch authorization", async () => {
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");

  assert.match(routes, /router\.use\(requireAuth, allow\(Role\.SUPER_ADMIN, Role\.BRANCH_ADMIN\)\)/);
  assert.match(routes, /organizationId: req\.auth!\.organizationId/);
  assert.match(routes, /erpBranchScope\(req\)/);
  assert.match(routes, /assertErpBranchTarget/);
  assert.match(routes, /assertErpBranchAccess/);
});

test("provision and token rotation return plaintext token once but persist only its hash", async () => {
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");
  assert.match(routes, /hashConnectedDeviceIngestToken\(token\)/);
  assert.match(routes, /credential: \{ ingestToken: token, displayOnce: true \}/);
  assert.doesNotMatch(routes, /ingestToken:\s*token[^\n]*data:/);
});

test("queued commands are never represented as dispatched before a protocol adapter acknowledges them", async () => {
  const routes = await readFile(new URL("./device-hub.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.post("/device-hub/devices/:deviceId/commands"');
  const section = routes.slice(start);

  assert.match(section, /status.*QUEUED|ConnectedDeviceCommandStatus/);
  assert.match(section, /dispatched: false/);
  assert.match(section, /protocol adapter must acknowledge delivery/i);
});

test("schema models maintain organization-scoped device, event, binding and command records", async () => {
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");

  assert.match(schema, /model ConnectedDevice \{/);
  assert.match(schema, /model ConnectedDeviceEvent \{/);
  assert.match(schema, /model ConnectedDeviceBinding \{/);
  assert.match(schema, /model ConnectedDeviceCommand \{/);
  assert.match(schema, /@@unique\(\[organizationId, code\]\)/);
  assert.match(schema, /@@unique\(\[deviceId, sourceHash\]\)/);
});
