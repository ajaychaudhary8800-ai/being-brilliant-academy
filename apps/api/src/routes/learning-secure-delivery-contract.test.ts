import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("secure assessment delivery state is persisted by migration and Prisma schema", async () => {
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = await readFile(new URL("../../prisma/migrations/20260930080000_learning_test_secure_delivery/migration.sql", import.meta.url), "utf8");

  assert.match(schema, /deliveryPolicy\s+Json\?/);
  assert.match(schema, /deliveryPolicySnapshot\s+Json\?/);
  assert.match(schema, /accommodationSnapshot\s+Json\?/);
  assert.match(schema, /offlineLeaseUntil\s+DateTime\?/);
  assert.match(schema, /model LearningTestIntegrityEvent \{/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "deliveryPolicy"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "LearningTestIntegrityEvent"/);
  assert.match(migration, /LearningTestIntegrityEvent_attemptId_fkey/);
});

test("secure delivery policy remains optional for legacy tests", async () => {
  const routes = await readFile(new URL("./learning-ecosystem.ts", import.meta.url), "utf8");

  assert.match(routes, /deliveryPolicy: learningTestDeliveryPolicySchema\.nullable\(\)\.optional\(\)/);
  assert.match(routes, /resolveLearningTestDeliveryForStudent\(test\.deliveryPolicy, actor\.userId\)/);
  assert.match(routes, /deliveryConfigured = currentDelivery\.configured/);
  assert.match(routes, /if \(!frozen\.configured\) return res\.json\(\{ data: \{ secured: false/);
});

test("secured test starts enforce attempt limits, accommodations and server adapter readiness", async () => {
  const routes = await readFile(new URL("./learning-ecosystem.ts", import.meta.url), "utf8");

  assert.match(routes, /learningTestAvailability/);
  assert.match(routes, /currentDelivery\.maximumAttempts/);
  assert.match(routes, /TEST_ATTEMPT_LIMIT_REACHED/);
  assert.match(routes, /learningTestAttemptExpiry/);
  assert.match(routes, /assessmentDeliveryProviderKeys/);
  assert.match(routes, /TEST_SECURITY_ADAPTER_UNAVAILABLE/);
  assert.match(routes, /TEST_CLIENT_INSTANCE_REQUIRED/);
});

test("secured delivery hides private policy and seed while returning only current accommodation", async () => {
  const routes = await readFile(new URL("./learning-ecosystem.ts", import.meta.url), "utf8");

  assert.match(routes, /deliveryPolicy: _privateDeliveryPolicy/);
  assert.match(routes, /deliverySeed: _deliverySeed/);
  assert.match(routes, /deliveryPolicySnapshot: _deliveryPolicySnapshot/);
  assert.match(routes, /accommodationSnapshot: _accommodationSnapshot/);
  assert.match(routes, /optionShuffleSkippedQuestionIds/);
  assert.match(routes, /extraTimeMinutes: accommodation\.extraTimeMinutes/);
});

test("heartbeat records integrity signals without automatic misconduct decisions", async () => {
  const routes = await readFile(new URL("./learning-ecosystem.ts", import.meta.url), "utf8");

  assert.match(routes, /router\.post\("\/learning\/attempts\/:id\/heartbeat"/);
  assert.match(routes, /OFFLINE_LEASE_RECOVERED/);
  assert.match(routes, /FULLSCREEN_EXIT/);
  assert.match(routes, /VISIBILITY_HIDDEN/);
  assert.match(routes, /PROCTORING_SIGNAL/);
  assert.match(routes, /LOCKDOWN_SIGNAL/);
  assert.match(routes, /Integrity events are review signals only and must not be treated as automatic evidence of misconduct/);
});

test("answer and submit mutations enforce configured client binding", async () => {
  const routes = await readFile(new URL("./learning-ecosystem.ts", import.meta.url), "utf8");

  assert.match(routes, /function assertLearningTestClientBinding/);
  assert.match(routes, /TEST_CLIENT_INSTANCE_MISMATCH/);
  assert.match(routes, /router\.put\("\/learning\/attempts\/:id\/answers\/:questionId"/);
  assert.match(routes, /router\.post\("\/learning\/attempts\/:id\/submit"/);
});

test("test managers can inspect integrity history only through normal learning resource authorization", async () => {
  const routes = await readFile(new URL("./learning-ecosystem.ts", import.meta.url), "utf8");
  const start = routes.indexOf('router.get("/learning/attempts/:id/integrity"');
  assert.ok(start >= 0);
  const section = routes.slice(start, start + 3500);

  assert.match(section, /managers/);
  assert.match(section, /organizationId: req\.auth!\.organizationId/);
  assert.match(section, /learningResourceWhere\(actor\)/);
  assert.match(section, /integrityEvents/);
});
