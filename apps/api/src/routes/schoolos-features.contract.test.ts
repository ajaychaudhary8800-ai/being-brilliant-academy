import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("tenant organization settings cannot overwrite commercial feature policy", async () => {
  const source = await readFile(new URL("organizations.ts", import.meta.url), "utf8");
  const tenantRoute = source.slice(source.indexOf('r.patch("/organization/settings"'));
  assert.match(tenantRoute, /advisory_xact_lock/);
  assert.match(tenantRoute, /commercialEntitlements:original\.commercialEntitlements/);
});

test("feature grant API requires platform identity and time-bound unpaid trials", async () => {
  const source = await readFile(new URL("schoolos-features.ts", import.meta.url), "utf8");
  assert.match(source, /homeOrganizationId !== "org_default"/);
  assert.match(source, /if \(change\.enabled === true && !includedInPlan\)/);
  assert.match(source, /SCHOOLOS_TRIAL_EXPIRY_REQUIRED/);
  assert.match(source, /SCHOOLOS_CLIENT_FEATURE_CHANGED/);
  assert.match(source, /advisory_xact_lock/);
});
