import assert from "node:assert/strict";
import test from "node:test";
import { organizationSettingsUpdateSchema } from "./organization.js";

test("normalizes a legacy null organization settings value", () => {
  const result = organizationSettingsUpdateSchema.parse({ settings: null });
  assert.deepEqual(result.settings, {});
});

test("does not overwrite settings when the field is omitted", () => {
  const result = organizationSettingsUpdateSchema.parse({ name: "Being Brilliant Academy" });
  assert.equal(Object.hasOwn(result, "settings"), false);
});

test("preserves an existing settings object", () => {
  const settings = { notifications: { email: true }, attendanceThreshold: 75 };
  const result = organizationSettingsUpdateSchema.parse({ settings });
  assert.deepEqual(result.settings, settings);
});

test("accepts stored organization logos while rejecting other uploaded-image kinds", () => {
  const logoUrl = "/api/v1/uploaded-images/organization-logo/org_default/123e4567-e89b-42d3-a456-426614174000.png";
  assert.equal(organizationSettingsUpdateSchema.parse({ logoUrl }).logoUrl, logoUrl);
  assert.throws(() => organizationSettingsUpdateSchema.parse({ logoUrl: logoUrl.replace("organization-logo", "student-photo") }));
});

test("accepts valid IANA Organization timezones and rejects invalid identifiers", () => {
  assert.equal(organizationSettingsUpdateSchema.parse({ timezone: "Asia/Calcutta" }).timezone, "Asia/Calcutta");
  assert.equal(organizationSettingsUpdateSchema.parse({ timezone: "America/New_York" }).timezone, "America/New_York");
  assert.throws(() => organizationSettingsUpdateSchema.parse({ timezone: "Invalid/Timezone" }));
});
