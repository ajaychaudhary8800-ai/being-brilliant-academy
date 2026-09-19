import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("non-admin organization settings response exposes only portal-safe presentation fields", async () => {
  const source = await readFile(new URL("./organizations.ts", import.meta.url), "utf8");
  assert.match(source, /const admin=q\.auth!\.role===Role\.SUPER_ADMIN\|\|q\.auth!\.role===Role\.BRANCH_ADMIN/);
  assert.match(source, /name:true,logoUrl:true,primaryColor:true,secondaryColor:true,timezone:true,locale:true,currency:true,groupLabelType:true,customGroupLabel:true,academicYearStartMonth:true,deletedAt:true/);
  assert.doesNotMatch(source, /select:\{[^}]*subscriptionStatus:true/);
  assert.doesNotMatch(source, /select:\{[^}]*subscriptionPlan:true/);
  assert.doesNotMatch(source, /select:\{[^}]*settings:true/);
  assert.doesNotMatch(source, /select:\{[^}]*trialEndsAt:true/);
  assert.doesNotMatch(source, /select:\{[^}]*subscriptionEndsAt:true/);
});
