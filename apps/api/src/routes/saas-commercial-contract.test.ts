import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schemaUrl = new URL("../../prisma/schema.prisma", import.meta.url);
const migrationUrl = new URL("../../prisma/migrations/20260921224500_add_saas_commercial_billing/migration.sql", import.meta.url);
const packagingMigrationUrl = new URL("../../prisma/migrations/20260924160000_align_commercial_plans/migration.sql", import.meta.url);

test("commercial SaaS schema keeps platform billing separate from learner invoices", async () => {
  const schema = await readFile(schemaUrl, "utf8");
  for (const model of ["SaaSPlan", "SaaSSubscription", "SaaSInvoice", "SaaSPayment", "SaaSWebhookEvent"]) {
    assert.match(schema, new RegExp(`model ${model} \\\{`));
  }
  assert.match(schema, /checkoutKey\s+String\?\s+@unique/);
  assert.match(schema, /taxRateBps\s+Int\s+@default\(0\)/);
  assert.match(schema, /saasSubscription\s+SaaSSubscription\?/);
  assert.match(schema, /planId\s+String[\s\S]*?plan\s+SaaSPlan\s+@relation\(fields: \[planId\]/);
  assert.match(schema, /model Invoice \{[\s\S]*?userId\s+String/);
});

test("SaaS migration seeds compatibility-safe plans and never edits learner invoice tables", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /CREATE TABLE "SaaSPlan"/);
  assert.match(migration, /CREATE TABLE "SaaSSubscription"/);
  assert.match(migration, /CREATE TABLE "SaaSInvoice"/);
  assert.match(migration, /CREATE TABLE "SaaSPayment"/);
  assert.match(migration, /'STANDARD'.*'\{"\*": true\}'/s);
  assert.match(migration, /'ENTERPRISE'.*'\{"\*": true\}'/s);
  assert.doesNotMatch(migration, /ALTER TABLE "Invoice"/);
  assert.doesNotMatch(migration, /ALTER TABLE "Payment"/);
  assert.match(migration, /saas_commercial_limit_check_fn/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /Branch_saas_commercial_limit_check/);
  assert.match(migration, /User_saas_commercial_limit_check/);
  assert.match(migration, /StudentProfile_saas_commercial_limit_check/);
});

test("commercial packaging matches Essentials, Growth, Professional and Enterprise", async () => {
  const migration = await readFile(packagingMigrationUrl, "utf8");
  assert.match(migration, /'ESSENTIALS'/);
  assert.match(migration, /'GROWTH'/);
  assert.match(migration, /'PROFESSIONAL'/);
  assert.match(migration, /WHERE "code" = 'ENTERPRISE'/);
  assert.match(migration, /"lms":true/);
  assert.match(migration, /"crm":true/);
  assert.match(migration, /"communication":true/);
  assert.match(migration, /"examinations":true/);
  assert.match(migration, /"hr_payroll":true/);
  assert.match(migration, /"analytics":true/);
  assert.match(migration, /"multi_branch":true/);
  assert.match(migration, /"white_label":true/);
  assert.match(migration, /"custom_domain":true/);
  assert.match(migration, /'\{"branches":1\}'::jsonb/);
  assert.match(migration, /WHERE "code" = 'STANDARD'/);
  assert.match(migration, /"isActive" = false/);
});

test("commercial entitlement enforcement is opt-in for existing tenants", async () => {
  const policy = await readFile(new URL("../lib/saas-commercial.ts", import.meta.url), "utf8");
  assert.match(policy, /commercialSettings\.enforce === true/);
  assert.match(policy, /if \(!policy\.enforcementEnabled\) return policy/);
  assert.match(policy, /assertCommercialPlanFitsUsage/);
  assert.match(policy, /PLAN_FEATURE_REQUIRED/);
  assert.match(policy, /PLAN_LIMIT_REACHED/);
});

test("tenant checkout is idempotent and platform subscription changes are audited", async () => {
  const route = await readFile(new URL("saas-commercial.ts", import.meta.url), "utf8");
  assert.match(route, /Idempotency-Key/);
  assert.match(route, /checkoutKey: idempotencyKey/);
  assert.match(route, /24 \* 60 \* 60 \* 1000/);
  assert.match(route, /SAAS_SUBSCRIPTION_UPDATED/);
  assert.match(route, /SAAS_CHECKOUT_CREATED/);
  assert.match(route, /requirePlatformAdmin/);
  assert.match(route, /requireTenantBillingAdmin/);
});

test("verified Razorpay webhook delegates SaaS orders before learner invoice reconciliation", async () => {
  const payments = await readFile(new URL("payments.ts", import.meta.url), "utf8");
  assert.match(payments, /captureSaaSRazorpayPayment\(payment, event\)/);
  const captureIndex = payments.indexOf("captureSaaSRazorpayPayment(payment, event)");
  const learnerInvoiceIndex = payments.indexOf("tx.invoice.findUnique");
  assert.ok(captureIndex >= 0 && learnerInvoiceIndex > captureIndex);
});


test("commercial feature middleware protects optional ERP modules", async () => {
  const expected = [
    ["transport.ts", "transport"],
    ["library.ts", "library"],
    ["hostel.ts", "hostel"],
    ["inventory.ts", "inventory"],
    ["analytics.ts", "analytics"],
    ["communication.ts", "communication"],
    ["hr-payroll.ts", "hr_payroll"],
    ["finance.ts", "finance"],
    ["admin-enquiries.ts", "crm"],
    ["admin-lms.ts", "lms"],
    ["learning.ts", "lms"],
    ["learning-ecosystem.ts", "lms"],
    ["premium-experience.ts", "lms"],
    ["admin-examinations.ts", "examinations"],
    ["examination-workflow.ts", "examinations"],
    ["admin-tests.ts", "examinations"],
    ["exams.ts", "examinations"],
  ] as const;
  for (const [file, feature] of expected) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.match(source, new RegExp(`requireCommercialFeature\\(["']${feature}["']\\)`), `${file} must enforce ${feature}`);
  }
});

test("commercial feature checks do not meter usage on every request", async () => {
  const policy = await readFile(new URL("../lib/saas-commercial.ts", import.meta.url), "utf8");
  const featureStart = policy.indexOf("export async function assertFeatureEntitled");
  const featureEnd = policy.indexOf("export async function assertCommercialPlanFitsUsage");
  const featureBlock = policy.slice(featureStart, featureEnd);
  assert.match(featureBlock, /commercialPolicySnapshot/);
  assert.doesNotMatch(featureBlock, /\.count\(/);
});

test("database capacity violations become plan-limit API conflicts", async () => {
  const http = await readFile(new URL("../lib/http.ts", import.meta.url), "utf8");
  assert.match(http, /SAAS_PLAN_LIMIT_REACHED:/);
  assert.match(http, /PLAN_LIMIT_REACHED/);
  assert.match(http, /commercialLimit \? 409/);
});


test("checkout cannot grant an unpaid plan", async () => {
  const route = await readFile(new URL("saas-commercial.ts", import.meta.url), "utf8");
  const policy = await readFile(new URL("../lib/saas-commercial.ts", import.meta.url), "utf8");
  const checkoutStart = route.indexOf("const subscription = await systemPrisma.saaSSubscription.upsert");
  const checkoutEnd = route.indexOf("let invoice = existing", checkoutStart);
  const checkoutSubscription = route.slice(checkoutStart, checkoutEnd);
  assert.doesNotMatch(checkoutSubscription, /update:\s*\{[^}]*planId:\s*plan\.id/s);
  assert.match(route, /planId: plan\.id/);
  assert.match(policy, /planId: invoice\.planId/);
  assert.match(policy, /subscriptionPlan: invoice\.plan\.code/);
});

test("SaaS billing UI keeps platform plans separate from tenant subscription checkout", async () => {
  const sidebar = await readFile(new URL("../../../web/components/sidebar.tsx", import.meta.url), "utf8");
  const plansPage = await readFile(new URL("../../../web/app/admin/saas-plans/page.tsx", import.meta.url), "utf8");
  const subscriptionPage = await readFile(new URL("../../../web/app/admin/subscription/page.tsx", import.meta.url), "utf8");
  const billingPage = await readFile(new URL("../../../web/app/admin/saas-billing/page.tsx", import.meta.url), "utf8");
  const nginx = await readFile(new URL("../../../../infra/nginx/nginx.conf", import.meta.url), "utf8");
  assert.match(sidebar, /SaaS Plans.*platformOnly: true/);
  assert.match(sidebar, /organization\/entitlements/);
  assert.match(sidebar, /commercialEntitlements\.entitlements\[entry\.feature\]/);
  assert.match(sidebar, /Examinations.*feature: "examinations"/s);
  assert.match(sidebar, /Subscription & Billing.*tenantOnly: true.*superAdminOnly: true/);
  assert.match(sidebar, /SaaS Billing.*platformOnly: true/);
  assert.match(plansPage, /\/platform\/saas\/plans/);
  assert.match(plansPage, /Module access/);
  assert.match(plansPage, /Examinations & tests/);
  assert.match(billingPage, /\/platform\/saas\/organizations\/\$\{selectedId\}\/subscription/);
  assert.match(billingPage, /Enforce plan features & limits/);
  assert.match(subscriptionPage, /Idempotency-Key/);
  assert.match(subscriptionPage, /activation is confirmed by the verified payment webhook/);
  assert.match(subscriptionPage, /checkout\.razorpay\.com\/v1\/checkout\.js/);
  assert.match(nginx, /https:\/\/checkout\.razorpay\.com/);
});


test("billing recovery is restricted to renewal surfaces", async () => {
  const authMiddleware = await readFile(new URL("../middleware/auth.ts", import.meta.url), "utf8");
  const authRoute = await readFile(new URL("auth.ts", import.meta.url), "utf8");
  const authProvider = await readFile(new URL("../../../web/components/auth-provider.tsx", import.meta.url), "utf8");
  const portalAuth = await readFile(new URL("../../../web/components/portal-auth.tsx", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../../../web/components/sidebar.tsx", import.meta.url), "utf8");

  assert.match(authMiddleware, /billingRecoveryEligible/);
  assert.match(authMiddleware, /BILLING_RECOVERY_ROUTE_BLOCKED/);
  assert.match(authMiddleware, /\/api\/v1\/organization\/subscription\/checkout/);
  assert.doesNotMatch(authMiddleware, /\/api\/v1\/admin\/overview.*return true/);
  assert.match(authRoute, /billingRecoveryEligible/);
  assert.match(authRoute, /billingRecovery/);
  assert.match(authProvider, /billingRecovery\?: boolean/);
  assert.match(authProvider, /recoveryBlocked/);
  assert.match(portalAuth, /user\.billingRecovery \? "\/admin\/subscription"/);
  assert.match(sidebar, /user\?\.billingRecovery.*entry\.href === "\/admin\/subscription"/);
  assert.match(sidebar, /user\?\.role === "ACCOUNTANT" \|\| user\?\.billingRecovery/);
});

test("subscription lifecycle reconciliation handles expiry and overdue states", async () => {
  const policy = await readFile(new URL("../lib/saas-commercial.ts", import.meta.url), "utf8");
  const server = await readFile(new URL("../server.ts", import.meta.url), "utf8");
  assert.match(policy, /reconcileSaaSLifecycle/);
  assert.match(policy, /SAAS_SUBSCRIPTION_PAST_DUE/);
  assert.match(policy, /SAAS_SUBSCRIPTION_CANCELLED/);
  assert.match(policy, /SAAS_TRIAL_EXPIRED/);
  assert.match(policy, /subscriptionStatus: OrganizationSubscriptionStatus\.PAST_DUE/);
  assert.match(server, /reconcileCommercialLifecycle/);
  assert.match(server, /5 \* 60_000/);
});


test("self-service cancellation and invoice documents are tenant-scoped", async () => {
  const route = await readFile(new URL("saas-commercial.ts", import.meta.url), "utf8");
  const policy = await readFile(new URL("../lib/saas-commercial.ts", import.meta.url), "utf8");
  const tenantPage = await readFile(new URL("../../../web/app/admin/subscription/page.tsx", import.meta.url), "utf8");
  const platformPage = await readFile(new URL("../../../web/app/admin/saas-billing/page.tsx", import.meta.url), "utf8");

  assert.match(route, /\/organization\/subscription\/cancellation/);
  assert.match(route, /status !== OrganizationSubscriptionStatus\.ACTIVE/);
  assert.match(route, /SAAS_CANCELLATION_SCHEDULED/);
  assert.match(route, /SAAS_CANCELLATION_REVOKED/);
  assert.match(route, /organizationId: req\.auth!\.organizationId/);
  assert.match(route, /\/organization\/subscription\/invoices\/:invoiceId\/pdf/);
  assert.match(route, /\/platform\/saas\/organizations\/:organizationId\/invoices\/:invoiceId\/pdf/);
  assert.match(route, /where: \{ id: String\(req\.params\.invoiceId\), organizationId/);
  assert.match(policy, /cancelAtPeriodEnd: false/);
  assert.match(tenantPage, /Cancel at period end/);
  assert.match(tenantPage, /Keep subscription active/);
  assert.match(tenantPage, /subscription\/invoices\/\$\{invoice\.id\}\/pdf/);
  assert.match(platformPage, /platform\/saas\/organizations\/\$\{selectedId\}\/invoices\/\$\{invoice\.id\}\/pdf/);
});

test("billing lifecycle reminders are deduplicated and queued for tenant super admins", async () => {
  const policy = await readFile(new URL("../lib/saas-commercial.ts", import.meta.url), "utf8");
  const server = await readFile(new URL("../server.ts", import.meta.url), "utf8");

  assert.match(policy, /queueSaaSBillingNotice/);
  assert.match(policy, /pg_advisory_xact_lock\(hashtext/);
  assert.match(policy, /sourceModule: "SAAS_BILLING"/);
  assert.match(policy, /role: Role\.SUPER_ADMIN, isActive: true/);
  assert.match(policy, /channels: \["IN_APP", "EMAIL"\]/);
  assert.match(policy, /channel: "EMAIL"/);
  assert.match(policy, /const window = remaining <= oneDay \? "1D" : "7D"/);
  assert.match(policy, /sourceEntityId: `\$\{subscription\.id\}:renewal:\$\{window\}:/);
  assert.match(policy, /past-due/);
  assert.match(policy, /trial-expired/);
  assert.match(policy, /renewalRemindersQueued/);
  assert.match(server, /result\.renewalRemindersQueued/);
});


test("white-label and custom-domain settings are plan-gated while core institution settings remain available", async () => {
  const [organizations, settingsPage] = await Promise.all([
    readFile(new URL("organizations.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../web/app/admin/organization-settings/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(organizations, /assertFeatureEntitled\(organizationId,"custom_domain"\)/);
  assert.match(organizations, /assertFeatureEntitled\(organizationId,"white_label"\)/);
  assert.match(settingsPage, /featureEnabled\("white_label"\)/);
  assert.match(settingsPage, /featureEnabled\("custom_domain"\)/);
  assert.match(settingsPage, /White-label branding and custom domains are not included/);
  assert.match(settingsPage, /Core institution settings remain available/);
});


test("an enforced tenant cannot be downgraded below its current branch/user/student usage", async () => {
  const route = await readFile(new URL("saas-commercial.ts", import.meta.url), "utf8");
  assert.match(route, /if \(commercialEntitlements\.enforce === true\) await assertCommercialPlanFitsUsage\(organizationId, plan\.limits\)/);
});


test("downgraded tenants may keep stored branding while core organization edits remain possible", async () => {
  const organizations = await readFile(new URL("organizations.ts", import.meta.url), "utf8");
  assert.match(organizations, /requireEntitledBrandingChange/);
  assert.match(organizations, /nextDomain&&nextDomain!==currentDomain/);
  assert.match(organizations, /JSON\.stringify\(nextWhiteLabel\)!==JSON\.stringify\(currentWhiteLabel\)/);
  assert.match(organizations, /select:\{logoUrl:true,settings:true\}/);
});
