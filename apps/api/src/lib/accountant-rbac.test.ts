import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Accountant role migration is additive and user provisioning is Super Admin only", async () => {
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = await readFile(new URL("../../prisma/migrations/20260908100000_add_accountant_role/migration.sql", import.meta.url), "utf8");
  const users = await readFile(new URL("../routes/admin-users.ts", import.meta.url), "utf8");
  const userPolicy = await readFile(new URL("user-administration-policy.ts", import.meta.url), "utf8");
  const defaulters = await readFile(new URL("../routes/fee-defaulters.ts", import.meta.url), "utf8");
  assert.match(schema.slice(schema.indexOf("enum Role"), schema.indexOf("enum OrganizationSubscriptionStatus")), /ACCOUNTANT/);
  assert.match(migration, /^-- AlterEnum\s+ALTER TYPE "Role" ADD VALUE 'ACCOUNTANT';\s*$/);
  assert.match(users, /router\.post\("\/users\/accountants", allow\(Role\.SUPER_ADMIN\)/);
  assert.match(users, /router\.put\("\/users\/:id\/accountant-branches", allow\(Role\.SUPER_ADMIN\)/);
  assert.match(users, /router\.use\(requireAuth, allow\(Role\.SUPER_ADMIN, Role\.BRANCH_ADMIN\)\)/);
  assert.match(users, /assertCanAdministerUserTarget\(req\.auth!\.role, target\.role\)/);
  assert.match(users, /router\.patch\("\/users\/:id"[\s\S]*?loadTarget\(req, String\(req\.params\.id\)\)/);
  assert.match(users, /router\.post\("\/users\/:id\/setup-email"[\s\S]*?loadTarget\(req, String\(req\.params\.id\)\)/);
  assert.match(userPolicy, /targetRole === Role\.ACCOUNTANT && actorRole !== Role\.SUPER_ADMIN/);
  assert.match(users, /organizationId: req\.auth!\.organizationId/);
  assert.match(defaulters, /Role\.ACCOUNTANT/);
  assert.match(defaulters, /requireRequestedBranch\(req\.auth!\.role, await assignedBranches\(req\), q\.branchId\)/);
});

test("Accountant frontend navigation is limited to finance and fee workspaces", async () => {
  const sidebar = await readFile(new URL("../../../web/components/sidebar.tsx", import.meta.url), "utf8");
  const workspace = await readFile(new URL("../../../web/components/admin-workspace.tsx", import.meta.url), "utf8");
  const auth = await readFile(new URL("../../../web/components/auth-provider.tsx", import.meta.url), "utf8");
  const provisioning = await readFile(new URL("../../../web/app/admin/accountants/page.tsx", import.meta.url), "utf8");
  assert.match(auth, /ACCOUNTANT/);
  assert.match(sidebar, /user\?\.role === "ACCOUNTANT"/);
  assert.match(sidebar, /\/admin\/finance/);
  assert.match(workspace, /ACCOUNTANT/);
  assert.match(provisioning, /AuthGate roles=\{\["SUPER_ADMIN"\]\}/);
  assert.match(provisioning, /\/admin\/users\/accountants/);
});

test("Accountant fee requests reach the role-aware routers before broad admin guards", async () => {
  const server = await readFile(new URL("../server.ts", import.meta.url), "utf8");
  const scopedFeeMount = 'app.use("/api/v1/admin", onlyPaths(["/fees"], adminFees))';
  const defaulterMount = 'app.use("/api/v1", onlyPaths(["/admin/fee-defaulters"], feeDefaulters))';
  const firstBroadAdminMount = 'app.use("/api/v1/admin", adminAcademicSessions)';
  assert.ok(server.indexOf(scopedFeeMount) > -1);
  assert.ok(server.indexOf(defaulterMount) > -1);
  assert.ok(server.indexOf(firstBroadAdminMount) > server.indexOf(scopedFeeMount));
  assert.ok(server.indexOf(firstBroadAdminMount) > server.indexOf(defaulterMount));
  assert.equal(server.indexOf(scopedFeeMount), server.lastIndexOf(scopedFeeMount));
  assert.equal(server.indexOf(defaulterMount), server.lastIndexOf(defaulterMount));
});

test("Accountant fee pages avoid admin-only initialization and suppress prohibited controls", async () => {
  const fees = await readFile(new URL("../../../web/app/admin/fees/page.tsx", import.meta.url), "utf8");
  const feeWorkspace = await readFile(new URL("../../../web/components/finance-workspace.tsx", import.meta.url), "utf8");
  const finance = await readFile(new URL("../../../web/app/admin/finance/page.tsx", import.meta.url), "utf8");
  const auth = await readFile(new URL("../../../web/components/auth-provider.tsx", import.meta.url), "utf8");

  assert.match(fees, /AuthGate roles=\{\["SUPER_ADMIN","BRANCH_ADMIN","ACCOUNTANT"\]\}/);
  assert.match(feeWorkspace, /const canManage = user\?\.role === "SUPER_ADMIN" \|\| user\?\.role === "BRANCH_ADMIN"/);
  assert.match(feeWorkspace, /if \(!canManage \|\| studentSearch\.trim\(\)\.length < 2\)[^]*\/admin\/students\?\$\{query\}/);
  assert.match(feeWorkspace, /if \(canManage && !sessions\.length\)[^]*\/admin\/batches/);
  assert.match(feeWorkspace, /canManage[^]*New Fee Plan/);
  assert.match(feeWorkspace, /canManage[^]*Manual Fee/);
  assert.match(feeWorkspace, /canManage[^]*Edit/);
  assert.match(feeWorkspace, /canOffset=\{canManage\}/);
  assert.match(feeWorkspace, />Collect<\/button>/);
  assert.match(feeWorkspace, /\/admin\/fees\/\$\{collecting\.id\}\/collect/);
  assert.match(finance, /canImportAccounts && tab === "accounts" && <label/);
  assert.match(finance, /user\?\.role === "SUPER_ADMIN" \|\| user\?\.role === "BRANCH_ADMIN"/);
  assert.doesNotMatch(auth, /accountantFeeAccess/);
});
