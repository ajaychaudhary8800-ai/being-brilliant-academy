import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./admin-courses.ts", import.meta.url), "utf8");

test("branch admins cannot mutate organization-wide courses", () => {
  assert.match(source, /async function writeScope/);
  assert.match(source, /BRANCH_SCOPE_REQUIRED/);
  assert.match(source, /await writeScope\(req, data\.branchId\)/);
  assert.match(source, /await writeScope\(req, old\.branchId\)/);
  assert.match(source, /await writeScope\(req, existing\.branchId\)/);
  assert.match(source, /await writeScope\(req, course\.branchId\)/);
});
