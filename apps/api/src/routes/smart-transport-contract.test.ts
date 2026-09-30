import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("smart transport mounts under existing transport API surface", async () => {
  const server = await readFile(new URL("../server.ts", import.meta.url), "utf8");
  assert.match(server, /import smartTransport from ".\/routes\/smart-transport\.js"/);
  assert.match(server, /onlyPaths\(\["\/transport"\], smartTransport\)/);
});

test("smart transport remains auth, branch and commercial-feature scoped", async () => {
  const routes = await readFile(new URL("./smart-transport.ts", import.meta.url), "utf8");
  assert.match(routes, /requireAuth/);
  assert.match(routes, /allow\(Role\.SUPER_ADMIN, Role\.BRANCH_ADMIN\)/);
  assert.match(routes, /requireCommercialFeature\("transport"\)/);
  assert.match(routes, /erpBranchScope/);
  assert.match(routes, /assertErpBranchAccess/);
});

test("branch transport policy controls overspeed and GPS thresholds", async () => {
  const routes = await readFile(new URL("./smart-transport.ts", import.meta.url), "utf8");
  assert.match(routes, /overspeedKph/);
  assert.match(routes, /gpsOfflineMinutes/);
  assert.match(routes, /harshAccelerationMps2/);
  assert.match(routes, /harshBrakingMps2/);
  assert.match(routes, /TRANSPORT_SAFETY_POLICY_UPDATED/);
});

test("GPS processing emits replay-safe multiple alert types per source event", async () => {
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const processor = await readFile(new URL("../lib/device-hub-processor.ts", import.meta.url), "utf8");
  assert.match(schema, /@@unique\(\[sourceEventId, type\]\)/);
  assert.match(processor, /TransportAlertType\.OVERSPEED/);
  assert.match(processor, /TransportAlertType\.HARSH_ACCELERATION/);
  assert.match(processor, /TransportAlertType\.HARSH_BRAKING/);
  assert.match(processor, /TransportAlertType\.ROUTE_DEVIATION/);
});

test("ridership detects wrong bus, wrong stop and cancellation conflicts", async () => {
  const processor = await readFile(new URL("../lib/device-hub-processor.ts", import.meta.url), "utf8");
  assert.match(processor, /TRANSPORT_RIDERSHIP/);
  assert.match(processor, /TransportAlertType\.WRONG_BUS/);
  assert.match(processor, /TransportAlertType\.WRONG_STOP/);
  assert.match(processor, /transportRideCancellation/);
});

test("trip replay and still-onboard endpoints are bounded and branch scoped", async () => {
  const routes = await readFile(new URL("./smart-transport.ts", import.meta.url), "utf8");
  assert.match(routes, /\/transport\/intelligence\/trips\/:tripId\/replay/);
  assert.match(routes, /limit: z\.coerce\.number\(\)\.int\(\)\.min\(1\)\.max\(10000\)/);
  assert.match(routes, /\/transport\/intelligence\/trips\/:tripId\/still-onboard/);
  assert.match(routes, /assertErpBranchAccess/);
});

test("fleet intelligence exposes service, document, fuel and alert health", async () => {
  const routes = await readFile(new URL("./smart-transport.ts", import.meta.url), "utf8");
  assert.match(routes, /servicesDue/);
  assert.match(routes, /documentsExpiring/);
  assert.match(routes, /openAlertsByType/);
  assert.match(routes, /fuelTotals/);
});
