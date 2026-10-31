import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = new URL("../../../web/app/admin/branches/page.tsx", import.meta.url);

test("deferred BBA branch manager appointment is visible only to SUPER_ADMIN for active unassigned branches", async () => {
  const source = await readFile(page, "utf8");
  assert.match(source, /"manager" \| null/);
  assert.match(source, /user\?\.role === "SUPER_ADMIN" && item\.isActive && !item\.managerEmail/);
  assert.match(source, /open\("manager", item\)/);
  assert.match(source, /Appoint Branch Admin/);
  assert.match(source, /Existing manager accounts cannot be replaced here/);
});

test("manager appointment UI only sends manager name and controlled email", async () => {
  const source = await readFile(page, "utf8");
  assert.match(source, /mode === "manager" \? \{ managerName: form\.managerName\.trim\(\), managerEmail: form\.managerEmail\.trim\(\)\.toLowerCase\(\) \}/);
  assert.match(source, /mode === "manager" \? `\$\{API_URL\}\/admin\/branches\/\$\{selected!\.id\}\/manager`/);
  assert.match(source, /mode === "add" \|\| mode === "manager" \? "POST" : "PUT"/);
  assert.match(source, /setup\?\.reason === "EMAIL_DELIVERY_FAILED"/);
  assert.match(source, /setup\?\.reason === "ALREADY_ASSIGNED"/);
  assert.match(source, /setup\?\.reason === "EXISTING_MANAGER_ACCOUNT"/);
});
