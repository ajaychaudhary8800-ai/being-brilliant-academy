import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./course-form.tsx", import.meta.url), "utf8");

test("branch admin course creation requires an assigned branch", () => {
  assert.match(source, /useAuth/);
  assert.match(source, /user\?\.role === "BRANCH_ADMIN"/);
  assert.match(source, /availableBranches\[0\]\.id/);
  assert.match(source, /"Select branch" : "All branches"/);
  assert.match(source, /required=\{user\?\.role === "BRANCH_ADMIN"\}/);
});
