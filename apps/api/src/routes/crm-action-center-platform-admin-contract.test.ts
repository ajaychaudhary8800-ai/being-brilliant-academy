import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("CRM action center hides mine-only filtering for platform administrators", async () => {
  const route = await readFile(new URL("admin-enquiries.ts", import.meta.url), "utf8");
  const start = route.indexOf('router.get("/enquiries/action-center"');
  const end = route.indexOf('router.get("/enquiries/export"', start);
  assert.ok(start >= 0 && end > start);
  const block = route.slice(start, end);

  assert.match(block, /req\.auth!\.role===Role\.SUPER_ADMIN&&req\.auth!\.homeOrganizationId==="org_default"/);
  assert.match(block, /const localCounsellor=isPlatformAdmin\?null:/);
  assert.match(block, /const mineAvailable=!isPlatformAdmin&&Boolean\(localCounsellor\)/);
  assert.match(block, /const mine=q\.mine==="true"&&mineAvailable/);
  assert.doesNotMatch(block, /homeOrganizationId!==organizationId/);
});
