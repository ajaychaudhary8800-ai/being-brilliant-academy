import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const adminPages = [
  "../app/admin/users/page.tsx",
  "../app/admin/branches/page.tsx",
  "../app/admin/teachers/page.tsx",
  "../app/admin/homeworks/page.tsx",
  "../app/admin/timetables/page.tsx",
  "../app/admin/examinations/page.tsx",
];

test("tenant admin surfaces do not hard-code academy operations", async () => {
  const workspace = await readFile(new URL("./admin-workspace.tsx", import.meta.url), "utf8");
  assert.match(workspace, /useGroupTerminology/);
  assert.match(workspace, /terms\.institution\.toUpperCase\(\)/);
  assert.doesNotMatch(workspace, />ACADEMY OPERATIONS<\/p>/);
  assert.doesNotMatch(workspace, /manage academy records/i);

  for (const page of adminPages) {
    const source = await readFile(new URL(page, import.meta.url), "utf8");
    assert.match(source, /useGroupTerminology/);
    assert.match(source, /terms\.institution\.toUpperCase\(\)/);
    assert.doesNotMatch(source, />ACADEMY OPERATIONS<\/p>/);
  }
});

test("account and settings UI respects tenant branding", async () => {
  const reset = await readFile(new URL("../app/reset-password/page.tsx", import.meta.url), "utf8");
  assert.match(reset, /useTenantBranding/);
  assert.match(reset, /brand\.appName/);
  assert.doesNotMatch(reset, /Being Brilliant Academy account/);
  assert.doesNotMatch(reset, /BEING <span/);

  const portal = await readFile(new URL("./portal-auth.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(portal, /Secure academy operations/);

  const settings = await readFile(new URL("../app/admin/organization-settings/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(settings, /replace Being Brilliant identity/);
});

test("dense admin action bars wrap on smaller screens", async () => {
  for (const page of ["../app/admin/homeworks/page.tsx", "../app/admin/examinations/page.tsx"]) {
    const source = await readFile(new URL(page, import.meta.url), "utf8");
    assert.match(source, /className="flex flex-wrap gap-2"/);
  }
});
