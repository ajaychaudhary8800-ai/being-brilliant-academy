import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schemaUrl = new URL("../../prisma/schema.prisma", import.meta.url);
const trialMigrationUrl = new URL("../../prisma/migrations/20260921233000_add_saas_plan_trial_days/migration.sql", import.meta.url);

test("SaaS plans own configurable default trial duration", async () => {
  const [schema, migration, api, page] = await Promise.all([
    readFile(schemaUrl, "utf8"),
    readFile(trialMigrationUrl, "utf8"),
    readFile(new URL("saas-commercial.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../web/app/admin/saas-plans/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /trialDays\s+Int\s+@default\(0\)/);
  assert.match(migration, /ADD COLUMN "trialDays" INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /"trialDays" >= 0 AND "trialDays" <= 3650/);
  assert.match(api, /trialDays: z\.number\(\)\.int\(\)\.min\(0\)\.max\(3650\)/);
  assert.match(api, /trialDays: true/);
  assert.match(page, /Default trial days/);
  assert.match(page, /trialDays: Math\.max\(0, Math\.floor\(Number\(form\.trialDays\)\)\)/);
});

test("tenant provisioning atomically creates organization admin and SaaS subscription", async () => {
  const source = await readFile(new URL("../lib/organization-provisioning.ts", import.meta.url), "utf8");
  assert.match(source, /systemPrisma\.saaSPlan\.findUnique/);
  assert.match(source, /subscriptionPlan \?\? "ESSENTIALS"/);
  assert.match(source, /enforce: typeof rawCommercial\.enforce === "boolean" \? rawCommercial\.enforce : true/);
  assert.match(source, /requestedCustomDomain/);
  assert.match(source, /planEntitlements\.custom_domain !== true/);
  assert.match(source, /!plan \|\| !plan\.isActive/);
  assert.match(source, /plan\.trialDays \* 24 \* 60 \* 60 \* 1000/);
  assert.match(source, /crypto\.randomBytes\(48\)/);
  assert.match(source, /tx\.organization\.create/);
  assert.match(source, /tx\.user\.create/);
  assert.match(source, /tx\.saaSSubscription\.create/);
  assert.match(source, /planId: plan\.id/);
  assert.match(source, /subscriptionPlan: plan\.code/);
  assert.match(source, /action: "ORGANIZATION_CREATED"/);
  assert.match(source, /emailVerifiedAt: input\.admin\.password \? new Date\(\) : null/);
});

test("platform organization provisioning defaults to secure setup email and supports resend", async () => {
  const route = await readFile(new URL("organization-provisioning.ts", import.meta.url), "utf8");
  assert.match(route, /adminPassword: z\.string\(\)\.min\(10\)\.max\(128\)\.optional\(\)/);
  assert.match(route, /sendSetupEmail: z\.boolean\(\)\.optional\(\)/);
  assert.match(route, /const setupRequested = data\.sendSetupEmail \?\? !data\.adminPassword/);
  assert.match(route, /provisionTenantOrganization/);
  assert.match(route, /issueAccountSetup\(result\.admin\)/);
  assert.match(route, /ORGANIZATION_ADMIN_SETUP_EMAIL_ISSUED/);
  assert.match(route, /\/platform\/organizations\/:id\/admin\/setup-email/);
  assert.match(route, /ORGANIZATION_ADMIN_SETUP_EMAIL_REISSUED/);
  assert.match(route, /requireUniqueCustomDomain\(data\.settings\)/);
  assert.match(route, /default\("ESSENTIALS"\)/);
  assert.match(route, /SETUP_EMAIL_FAILED/);
});

test("account setup tokens are explicitly tenant scoped and verify email on completion", async () => {
  const [setup, auth] = await Promise.all([
    readFile(new URL("../lib/account-setup.ts", import.meta.url), "utf8"),
    readFile(new URL("auth.ts", import.meta.url), "utf8"),
  ]);
  assert.match(setup, /systemPrisma\.passwordResetToken\.deleteMany/);
  assert.match(setup, /organizationId: user\.organizationId/);
  assert.match(setup, /systemPrisma\.passwordResetToken\.create/);
  assert.doesNotMatch(setup, /prisma\.passwordResetToken/);
  assert.match(auth, /emailVerifiedAt: reset\.user\.emailVerifiedAt \?\? new Date\(\)/);
  assert.match(auth, /session\.deleteMany\(\{ where: \{ userId: reset\.userId, organizationId: reset\.organizationId \} \}\)/);
});

test("platform organization UI uses plan catalogue and never asks staff for tenant admin password", async () => {
  const page = await readFile(new URL("../../../web/app/admin/organizations/page.tsx", import.meta.url), "utf8");
  assert.match(page, /api\("\/platform\/saas\/plans"\)/);
  assert.match(page, /subscriptionPlan: "ESSENTIALS"/);
  assert.match(page, /planHas\("custom_domain"\)/);
  assert.match(page, /sendSetupEmail: true/);
  assert.match(page, /secure one-time setup link/);
  assert.match(page, /Resend setup/);
  assert.match(page, /\/admin\/setup-email/);
  assert.match(page, /selected plan’s default trial duration/);
  assert.doesNotMatch(page, /Administrator password/);
  assert.doesNotMatch(page, /adminPassword:/);
  assert.match(page, /Subscription plan, status, billing cycle and entitlement enforcement are managed from SaaS Billing/);
  assert.match(page, /const patchPayload = editing \? \{ slug: form\.slug, name: form\.name, email: form\.email, \.\.\.branding \} : \{ \.\.\.branding \}/);
});

test("platform organization patch cannot bypass the subscription billing ledger", async () => {
  const organizations = await readFile(new URL("organizations.ts", import.meta.url), "utf8");
  const start = organizations.indexOf('r.patch("/platform/organizations/:id"');
  const end = organizations.indexOf('r.delete("/platform/organizations/:id"', start);
  assert.ok(start >= 0 && end > start);
  const block = organizations.slice(start, end);
  assert.match(block, /branding\.partial\(\)\.extend\(\{slug:/);
  assert.match(block, /isActive:z\.boolean\(\)\.optional\(\)\}\)\.strict\(\)\.parse/);
  assert.doesNotMatch(block, /subscriptionStatus/);
  assert.doesNotMatch(block, /subscriptionPlan/);
  assert.doesNotMatch(block, /trialEndsAt/);
  assert.doesNotMatch(block, /subscriptionEndsAt/);
});
