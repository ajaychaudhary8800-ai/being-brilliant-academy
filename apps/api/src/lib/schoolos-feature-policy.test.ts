import assert from "node:assert/strict";
import test from "node:test";
import {
  activeSchoolOSOverride,
  readSchoolOSFeatureOverrides,
  schoolOSEffectiveOverrideLists,
  schoolOSFeatureAccess,
  schoolOSFeatures,
} from "./schoolos-feature-policy.js";

const now = new Date("2026-10-18T12:00:00.000Z");
const override = (enabled: boolean, expiresAt: string | null = null) =>
  ({ enabled, reason: "Platform-approved test", expiresAt, changedBy: "platform-admin", changedAt: now.toISOString() });

test("catalogue uses unique registered module keys", () => {
  const keys = schoolOSFeatures.map(feature => feature.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.includes("lms"));
  assert.ok(keys.includes("white_label"));
});

test("explicit client disable defeats wildcard plan and legacy enforcement bypass", () => {
  const overrides = readSchoolOSFeatureOverrides({ lms: override(false) });
  assert.equal(schoolOSFeatureAccess({ "*": true }, true, overrides, "lms", now).enabled, false);
  assert.equal(schoolOSFeatureAccess({}, false, overrides, "lms", now).enabled, false);
  assert.equal(schoolOSFeatureAccess({}, false, overrides, "crm", now).enabled, true);
});

test("time-bounded trial enables feature only before expiry", () => {
  const overrides = readSchoolOSFeatureOverrides({ analytics: override(true, "2026-10-19T12:00:00.000Z") });
  assert.equal(schoolOSFeatureAccess({ analytics: false }, true, overrides, "analytics", now).enabled, true);
  assert.equal(schoolOSFeatureAccess({}, true, overrides, "analytics", new Date("2026-10-19T12:00:00Z")).enabled, false);
  assert.equal(activeSchoolOSOverride(overrides, "analytics", new Date("2026-10-20T00:00:00Z")), null);
});

test("expired or malformed expiry never creates a permanent grant", () => {
  const overrides = readSchoolOSFeatureOverrides({ lms: override(true, "not-a-date"), finance: override(true, "2026-01-01T00:00:00Z") });
  assert.equal(schoolOSFeatureAccess({}, true, overrides, "lms", now).enabled, false);
  assert.equal(schoolOSFeatureAccess({}, true, overrides, "finance", now).enabled, false);
  assert.deepEqual(schoolOSEffectiveOverrideLists(overrides, now), { deniedFeatures: [], enabledFeatures: [] });
});

test("tenant feature parsing drops unknown controls and prevents prototype keys", () => {
  const parsed = readSchoolOSFeatureOverrides({ lms: override(false), arbitrary: override(true), __proto__: override(true) });
  assert.deepEqual(Object.keys(parsed), ["lms"]);
  assert.equal(schoolOSFeatureAccess({}, true, parsed, "arbitrary", now).enabled, false);
});

test("plan eligibility still applies without client overrides", () => {
  assert.equal(schoolOSFeatureAccess({ crm: true }, true, {}, "crm", now).enabled, true);
  assert.equal(schoolOSFeatureAccess({ crm: false }, true, {}, "crm", now).enabled, false);
  assert.equal(schoolOSFeatureAccess({}, false, {}, "crm", now).source, "LEGACY");
});
