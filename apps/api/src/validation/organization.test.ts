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
