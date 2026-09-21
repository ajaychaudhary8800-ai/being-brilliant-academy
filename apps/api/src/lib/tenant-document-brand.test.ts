import assert from "node:assert/strict";
import test from "node:test";
import { tenantDocumentIdentity } from "./tenant-document-brand.js";

test("tenant document identity prefers configured white-label app name", () => {
  assert.deepEqual(
    tenantDocumentIdentity({
      name: "Fallback School",
      slug: "green-shine-world-school",
      settings: { whiteLabel: { appName: "Green Shine SchoolOS" } },
    }),
    { name: "Green Shine SchoolOS", certificatePrefix: "GREEN-SHINE-WORLD" },
  );
});

test("tenant document identity falls back to organization name and sanitizes the prefix", () => {
  assert.deepEqual(
    tenantDocumentIdentity({ name: "Example Institute", slug: "example_institute", settings: {} }),
    { name: "Example Institute", certificatePrefix: "EXAMPLE-INSTITUTE" },
  );
});
