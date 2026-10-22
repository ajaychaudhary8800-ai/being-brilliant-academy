import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("metering credit service is not a customer-accessible mint endpoint", async () => {
  const source = await readFile(new URL("../lib/schoolos-usage-service.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("schoolos-usage.ts", import.meta.url), "utf8");
  assert.match(source, /invoice\.status !== SaaSInvoiceStatus\.PAID/);
  assert.match(source, /SaaSPaymentStatus\.CAPTURED/);
  assert.match(source, /paidQuoteAddonGrantItems/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /consumedUnits: \{ lte: bucket\.grantedUnits - value\.units \}/);
  assert.match(source, /schoolOSUsageEvent\.create/);
  assert.doesNotMatch(route, /router\.(post|patch|put|delete)/);
  assert.match(route, /req\.auth\.homeOrganizationId !== req\.auth\.organizationId/);
  assert.match(route, /req\.auth\.homeOrganizationId !== "org_default"/);
});
test("usage tables have tenant-scoped foreign keys, unit checks and idempotency indices", async () => {
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = await readFile(new URL("../../prisma/migrations/20261018220000_schoolos_metered_usage_ledger/migration.sql", import.meta.url), "utf8");
  assert.match(schema, /model SchoolOSUsageBalance/);
  assert.match(schema, /model SchoolOSUsageEvent/);
  assert.match(migration, /"consumedUnits" <= "grantedUnits"/);
  assert.match(migration, /CREATE UNIQUE INDEX "SchoolOSUsageEvent_organizationId_metric_requestKey_key"/);
  assert.match(migration, /FOREIGN KEY \("organizationId"\) REFERENCES "Organization"/);
});
