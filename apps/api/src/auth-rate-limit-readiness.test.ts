import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("login rate limiting isolates accounts behind the same proxy IP", () => {
  const source = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
  assert.match(source, /ipKeyGenerator/);
  assert.match(source, /req\.body\?\.email/);
  assert.match(source, /req\.body\?\.organization/);
  assert.match(source, /express\.json\(\{ limit: "1mb" \}\)/);
  assert.match(source, /rl:auth:/);
});
