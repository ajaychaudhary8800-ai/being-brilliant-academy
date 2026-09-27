import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("CRM conversion uses secure account setup and never exposes or accepts a temporary password", async () => {
  const [route, page] = await Promise.all([
    readFile(new URL("admin-enquiries.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../web/app/admin/enquiries/page.tsx", import.meta.url), "utf8"),
  ]);

  const start = route.indexOf('router.post("/enquiries/:id/convert"');
  const end = route.indexOf('router.delete("/enquiries/:id"', start);
  assert.ok(start >= 0 && end > start);
  const block = route.slice(start, end);

  assert.doesNotMatch(block, /password:z\.string/);
  assert.doesNotMatch(block, /data\.password/);
  assert.match(block, /crypto\.randomBytes\(32\)/);
  assert.match(block, /issueAccountSetup/);
  assert.match(block, /PASSWORD_RESET_REQUESTED/);
  assert.match(block, /source:"CRM_CONVERSION"/);
  assert.match(block, /user:\{select:\{id:true,name:true,email:true,phone:true,role:true,isActive:true\}\}/);
  assert.doesNotMatch(block, /include:\{user:true/);

  assert.doesNotMatch(page, /Temporary Password/);
  assert.doesNotMatch(page, /name="password"/);
  assert.match(page, /secure one-time account setup link/);
  assert.match(page, /Account setup email was not sent/);
});
