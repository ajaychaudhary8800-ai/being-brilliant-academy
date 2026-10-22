import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("rate writing and approval remain separate platform-only operations", async () => {
  const route = await readFile(new URL("schoolos-addon-rates.ts", import.meta.url), "utf8");
  assert.match(route, /homeOrganizationId !== "org_default"/);
  assert.match(route, /rate\.createdBy === req\.auth!\.userId/);
  assert.match(route, /SCHOOLOS_ADDON_MAKER_CHECKER_REQUIRED/);
  assert.match(route, /SCHOOLOS_ADDON_APPROVAL_WINDOW_CONFLICT/);
  assert.match(route, /schoolOSAddonWindowOverlaps/);
  assert.match(route, /pg_advisory_xact_lock/);
  assert.match(route, /status: "APPROVED"/);
  assert.match(route, /SCHOOLOS_ADDON_RATE_APPROVED/);
});
test("all new quote line items require approved unique and immutable price snapshots", async () => {
  const route = await readFile(new URL("schoolos-quotations.ts", import.meta.url), "utf8");
  assert.match(route, /validateSchoolOSApprovedAddonLines\(/);
  assert.match(route, /SCHOOLOS_ADDON_PRICING_NOT_APPROVED/);
  assert.match(route, /addonRateSnapshot/);
  assert.match(route, /status: "APPROVED"/);
  const policy = await readFile(new URL("../lib/schoolos-addon-pricing-policy.ts", import.meta.url), "utf8");
  assert.match(policy, /eligible\.length !== 1/);
  assert.match(policy, /rate!\.unitPricePaise !== item\.unitPricePaise/);
  assert.match(policy, /rate!\.label !== item\.label/);
  assert.match(policy, /rate\.approvedBy !== rate\.createdBy/);
});
test("rate cataloguing must remain an additive, unseeded migration with database guardrails", async () => {
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = await readFile(new URL("../../prisma/migrations/20261018230000_schoolos_addon_rate_catalogue/migration.sql", import.meta.url), "utf8");
  assert.match(schema, /model SchoolOSAddonRate/);
  assert.match(migration, /"createdBy" <> "approvedBy"/);
  assert.match(migration, /"status" IN \('DRAFT', 'APPROVED'\)/);
  assert.doesNotMatch(migration, /INSERT INTO "SchoolOSAddonRate"/);
  assert.doesNotMatch(migration, /UPDATE "SaaSPlan"/);
  const api = await readFile(new URL("schoolos-addon-rates.ts", import.meta.url), "utf8");
  assert.doesNotMatch(api, /saaSInvoice\.(?:create|update|upsert)/);
  assert.doesNotMatch(api, /saaSSubscription\.(?:create|update|upsert)/);
});
