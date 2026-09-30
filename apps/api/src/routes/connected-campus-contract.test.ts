import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("connected-campus API is mounted without replacing Version 3 transport or device routes", async () => {
  const server = await readFile(new URL("../server.ts", import.meta.url), "utf8");
  assert.match(server, /import connectedCampus from ".\/routes\/connected-campus\.js"/);
  assert.match(server, /onlyPaths\(\["\/connected-campus"\], connectedCampus\)/);
  assert.match(server, /onlyPaths\(\["\/transport"\], transport\)/);
  assert.match(server, /onlyPaths\(\["\/device-hub"\], deviceHub\)/);
});

test("parent pickup authorization requires a linked active child", async () => {
  const routes = await readFile(new URL("./connected-campus.ts", import.meta.url), "utf8");
  assert.match(routes, /parentStudent\.findFirst/);
  assert.match(routes, /parentId: req\.auth!\.userId/);
  assert.match(routes, /studentId/);
  assert.match(routes, /CHILD_ACCESS_DENIED/);
});

test("pickup credentials are returned only at creation while list output hides their hashes", async () => {
  const routes = await readFile(new URL("./connected-campus.ts", import.meta.url), "utf8");
  assert.match(routes, /credential:\s*\{[\s\S]*qrToken: credentials\.qrToken,[\s\S]*otp: credentials\.otp,[\s\S]*displayOnce: true/);
  assert.match(routes, /qrTokenHash: undefined, otpHash: undefined/);
  assert.doesNotMatch(routes, /qrToken:\s*authorization\./);
});

test("pickup gate verification accepts QR or authorization ID plus OTP and is race-safe", async () => {
  const routes = await readFile(new URL("./connected-campus.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.post("/connected-campus/gate/pickup/verify"');
  assert.ok(start >= 0);
  const section = routes.slice(start, start + 12000);
  assert.match(section, /hashPickupQrToken/);
  assert.match(section, /verifyPickupOtp/);
  assert.match(section, /updateMany/);
  assert.match(section, /usedCount: \{ lt: authorization\.useLimit \}/);
  assert.match(section, /PICKUP_AUTHORIZATION_RACE_RECHECK/);
});

test("pickup gate verification is branch-admin scoped and creates a school event", async () => {
  const routes = await readFile(new URL("./connected-campus.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.post("/connected-campus/gate/pickup/verify"');
  const section = routes.slice(start, start + 14000);
  assert.match(section, /allow\(\.\.\.adminRoles\)/);
  assert.match(section, /assertAdminBranch/);
  assert.match(section, /SchoolEventCategory\.PICKUP/);
  assert.match(section, /PICKUP_GATE_VERIFIED/);
});

test("visitor host approval is restricted to assigned host or branch administrator", async () => {
  const routes = await readFile(new URL("./connected-campus.ts", import.meta.url), "utf8");
  assert.match(routes, /VISITOR_HOST_FORBIDDEN/);
  assert.match(routes, /visitor\.hostUserId !== req\.auth!\.userId/);
  assert.match(routes, /assertErpBranchAccess/);
});

test("visitor identity storage is deliberately limited to proof type and last four characters", async () => {
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const start = schema.indexOf("model CampusVisitor {");
  const end = schema.indexOf("\n}", start);
  const model = schema.slice(start, end);
  assert.match(model, /idProofType\s+String\?/);
  assert.match(model, /idProofLast4\s+String\?/);
  assert.doesNotMatch(model, /idProofData|idProofBytes|aadhaar|passportNumber/i);
});

test("parent transport and safety timeline endpoints reuse linked-child authorization", async () => {
  const routes = await readFile(new URL("./connected-campus.ts", import.meta.url), "utf8");
  assert.match(routes, /\/connected-campus\/parent\/transport\/:studentId/);
  assert.match(routes, /\/connected-campus\/parent\/timeline\/:studentId/);
  assert.match(routes, /linkedChild\(req/);
  assert.match(routes, /schoolEvent\.findMany/);
});

test("parent ride cancellation is tied to active transport assignment and audited", async () => {
  const routes = await readFile(new URL("./connected-campus.ts", import.meta.url), "utf8");
  assert.match(routes, /transportRideCancellation\.create/);
  assert.match(routes, /TransportStatus\.ACTIVE/);
  assert.match(routes, /PARENT_TRANSPORT_RIDE_CANCELLED/);
});
