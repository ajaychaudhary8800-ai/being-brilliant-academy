import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = () => readFileSync(new URL("../app/admin/branches/page.tsx", import.meta.url), "utf8");

test("branch creation UI matches the RC1 manager provisioning contract", () => {
  const source = page();
  assert.match(source, /managerEmail: string/);
  assert.match(source, /label="Manager Login Email"/);
  assert.match(source, /user\?\.role === "SUPER_ADMIN"/);
  assert.match(source, /Branch and manager account created/);
  assert.match(source, /mode === "add" \? form/);
  assert.match(source, /key !== "managerEmail"/);
});

test("manager login email is creation-only in the RC1 branch UI", () => {
  const source = page();
  assert.match(source, /managerEditable=\{mode === "add" && user\?\.role === "SUPER_ADMIN"\}/);
  assert.match(source, /disabled=\{view \|\| !managerEditable\}/);
});
