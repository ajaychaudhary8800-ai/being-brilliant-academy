import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("tenant admin provisioning uses invitation-based password ownership", async () => {
  const provisioning = await readFile(new URL("organization-provisioning.ts", import.meta.url), "utf8");
  const accountSetup = await readFile(new URL("../lib/account-setup.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../../../web/app/admin/organizations/page.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(provisioning, /adminPassword/);
  assert.match(provisioning, /crypto\.randomBytes\(48\)/);
  assert.match(provisioning, /issueAccountSetup\(admin\)/);
  assert.match(provisioning, /TENANT_ADMIN_SETUP_REQUESTED/);
  assert.match(provisioning, /setup = await deliverTenantAdminSetup/);
  assert.doesNotMatch(provisioning, /emailVerifiedAt:\s*new Date/);

  assert.match(accountSetup, /systemPrisma\.passwordResetToken\.deleteMany/);
  assert.match(accountSetup, /systemPrisma\.passwordResetToken\.create/);
  assert.doesNotMatch(accountSetup, /prisma\.passwordResetToken/);

  assert.doesNotMatch(page, /Administrator password/);
  assert.match(page, /secure one-time setup link/);
  assert.match(page, /Resend setup/);
  assert.match(page, /administrator setup email sent/i);
});

test("platform admin setup resend is tenant-scoped and ambiguity-safe", async () => {
  const provisioning = await readFile(new URL("organization-provisioning.ts", import.meta.url), "utf8");

  assert.match(provisioning, /\/platform\/organizations\/:organizationId\/admin-setup-email/);
  assert.match(provisioning, /requirePlatformAdmin\(req\)/);
  assert.match(provisioning, /organizationId,/);
  assert.match(provisioning, /role:\s*Role\.SUPER_ADMIN/);
  assert.match(provisioning, /isActive:\s*true/);
  assert.match(provisioning, /TENANT_ADMIN_SELECTION_REQUIRED/);
  assert.match(provisioning, /adminEmail/);
  assert.match(provisioning, /res\.status\(202\)/);
});
