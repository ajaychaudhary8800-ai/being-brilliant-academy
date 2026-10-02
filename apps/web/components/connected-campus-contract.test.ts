import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Connected Campus requests branches within the admin branch API limit", async () => {
  const source = await readFile(new URL("../app/admin/connected-campus/page.tsx", import.meta.url), "utf8");
  assert.match(source, /\/admin\/branches\?limit=100&status=active/);
  assert.doesNotMatch(source, /\/admin\/branches\?limit=200&status=active/);
});
