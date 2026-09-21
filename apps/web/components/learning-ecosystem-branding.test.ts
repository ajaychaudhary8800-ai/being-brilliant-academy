import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("learning ecosystem header uses tenant branding", async () => {
  const source = await readFile(new URL("./learning-ecosystem-workspace.tsx", import.meta.url), "utf8");
  assert.match(source, /useTenantBranding/);
  assert.match(source, /brand\.appName/);
  assert.doesNotMatch(source, /BEING BRILLIANT ACADEMY/);
  assert.doesNotMatch(source, /India-focused preparation for CBSE, JEE, NEET and CUET/);
});
