import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const path = new URL("./admin.ts", import.meta.url);

test("existing-branch manager appointment requires SUPER_ADMIN, not a branch admin", async () => {
  const source = await readFile(path, "utf8");
  const start = source.indexOf('router.post("/branches/:id/manager"');
  const end = source.indexOf('router.put("/branches/:id"', start);
  assert.ok(start > 0 && end > start);
  const handler = source.slice(start, end);
  assert.match(handler, /req\.auth!\.role !== Role\.SUPER_ADMIN/);
  assert.ok(handler.indexOf('req.auth!.role !== Role.SUPER_ADMIN') < handler.indexOf("prisma.$transaction"));
  assert.match(handler, /organizationId: req\.auth!\.organizationId/);
  assert.match(handler, /validateExistingBranchManagerAssignment\(/);
});

test("appointment is serializable, tenant-local, idempotent and does not silently replace a manager", async () => {
  const source = await readFile(path, "utf8");
  const start = source.indexOf('router.post("/branches/:id/manager"');
  const end = source.indexOf('router.put("/branches/:id"', start);
  const handler = source.slice(start, end);
  assert.match(handler, /retrySerializableWrite\(/);
  assert.match(handler, /Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(handler, /where: \{ id: branchId, organizationId: req\.auth!\.organizationId \}/);
  assert.match(handler, /where: \{ branchId, organizationId: req\.auth!\.organizationId \}/);
  assert.match(handler, /decision === "ALREADY_ASSIGNED"/);
  assert.match(handler, /branchUser\.create\(/);
  assert.match(handler, /BRANCH_MANAGER_APPOINTED/);
  assert.match(handler, /MANAGER_ACCOUNT_CONFLICT/);
  assert.doesNotMatch(handler, /role:\s*Role\.BRANCH_ADMIN\s*\}\s*\)/, "Never change existing user's role");
  assert.match(handler, /role: Role\.BRANCH_ADMIN/, "New manager must be created as branch administrator");
});

test("account setup uses random unusable initial password and sends email outside transaction", async () => {
  const source = await readFile(path, "utf8");
  const start = source.indexOf('router.post("/branches/:id/manager"');
  const end = source.indexOf('router.put("/branches/:id"', start);
  const handler = source.slice(start, end);
  assert.match(handler, /crypto\.randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(handler, /bcrypt\.hash\(/);
  assert.ok(handler.indexOf("issueAccountSetup(") > handler.indexOf("result.managerCreated"));
  assert.match(handler, /reason: "ALREADY_ASSIGNED"/);
  assert.match(handler, /reason: "EXISTING_MANAGER_ACCOUNT"/);
  assert.match(handler, /reason: "EMAIL_DELIVERY_FAILED"/);
  assert.doesNotMatch(handler, /password:|rawPassword:/);
});
