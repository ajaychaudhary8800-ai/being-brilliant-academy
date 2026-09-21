import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("teacher student and parent portal header uses tenant branding", async () => {
  const source = await readFile(new URL("./portal-workspace.tsx", import.meta.url), "utf8");
  assert.match(source, /useTenantBranding/);
  assert.match(source, /brand\.appName/);
  assert.doesNotMatch(source, /Being Brilliant \{terms\.institution\}/);
});

test("generic forgot-password flow keeps tenant workspace and brand", async () => {
  const source = await readFile(new URL("../app/forgot-password/page.tsx", import.meta.url), "utf8");
  assert.match(source, /useTenantBranding/);
  assert.match(source, /requestPasswordReset\(email, brand\.slug\)/);
  assert.match(source, /\{brand\.appName\}/);
  assert.doesNotMatch(source, />BEING <span[^>]*>BRILLIANT<\/span>/);
});
