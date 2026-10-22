import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
test("quotation records are additive, versioned and never change customer subscriptions", async () => {
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = await readFile(new URL("../../prisma/migrations/20261018190000_schoolos_quote_drafts/migration.sql", import.meta.url), "utf8");
  const route = await readFile(new URL("schoolos-quotations.ts", import.meta.url), "utf8");
  assert.match(schema, /model SchoolOSQuotation/);
  assert.match(schema, /model SchoolOSQuotationRevision/);
  assert.match(migration, /CREATE TABLE "SchoolOSQuotation"/);
  assert.match(migration, /CREATE UNIQUE INDEX "SchoolOSQuotationRevision_quoteId_version_key"/);
  assert.doesNotMatch(migration, /ALTER TABLE "SaaSPlan"/);
  assert.doesNotMatch(migration, /ALTER TABLE "SaaSSubscription"/);
  assert.match(route, /requirePlatformAdmin\(req\)/);
  assert.match(route, /status: "DRAFT"/);
  assert.doesNotMatch(route, /saaSSubscription\.update/);
  assert.doesNotMatch(route, /saaSSubscription\.upsert/);
  assert.match(route, /expectedVersion/);
});
