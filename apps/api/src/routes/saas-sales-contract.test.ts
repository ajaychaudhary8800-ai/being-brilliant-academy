import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeUrl = new URL("saas-sales.ts", import.meta.url);
const schemaUrl = new URL("../../prisma/schema.prisma", import.meta.url);
const migrationUrl = new URL("../../prisma/migrations/20260925122000_add_saas_sales_pipeline/migration.sql", import.meta.url);
const landingUrl = new URL("../../../web/components/premium-landing.tsx", import.meta.url);
const sidebarUrl = new URL("../../../web/components/sidebar.tsx", import.meta.url);
const pageUrl = new URL("../../../web/app/admin/saas-sales/page.tsx", import.meta.url);
const playbookUrl = new URL("../../../../docs/SAAS_SALES_PLAYBOOK.md", import.meta.url);

test("Step 10 has a dedicated platform SaaS sales data model separate from tenant admissions", async () => {
  const [schema, migration] = await Promise.all([readFile(schemaUrl, "utf8"), readFile(migrationUrl, "utf8")]);
  assert.match(schema, /model SaaSSalesLead \{/);
  assert.match(schema, /model SaaSSalesActivity \{/);
  assert.match(schema, /expectedAnnualValuePaise/);
  assert.match(schema, /wonOrganizationId/);
  assert.match(migration, /CREATE TABLE "SaaSSalesLead"/);
  assert.match(migration, /CREATE TABLE "SaaSSalesActivity"/);
  assert.doesNotMatch(migration, /ALTER TABLE "Enquiry"/);
  assert.doesNotMatch(migration, /ALTER TABLE "PremiumLead"/);
});

test("public product demo enters SaaS sales instead of legacy premium learner leads", async () => {
  const [landing, route] = await Promise.all([readFile(landingUrl, "utf8"), readFile(routeUrl, "utf8")]);
  assert.match(landing, /\/public\/saas-sales\/leads/);
  assert.doesNotMatch(landing, /fetch\(API \+ "\/premium\/leads"/);
  const publicRoute = route.indexOf('router.post("/public/saas-sales/leads"');
  const authGuard = route.indexOf("router.use(requireAuth)");
  assert.ok(publicRoute >= 0 && authGuard > publicRoute, "public lead creation must remain before router authentication");
  assert.match(route, /deduplicated: true/);
  assert.match(route, /30 \* 24 \* 60 \* 60 \* 1000/);
});

test("platform SaaS sales APIs require platform Super Admin after public intake", async () => {
  const route = await readFile(routeUrl, "utf8");
  assert.match(route, /PLATFORM_ADMIN_REQUIRED/);
  assert.match(route, /homeOrganizationId !== "org_default"/);
  assert.match(route, /\/platform\/sales\/dashboard/);
  assert.match(route, /\/platform\/sales\/leads/);
  assert.match(route, /WON_ORGANIZATION_REQUIRED/);
  assert.match(route, /LOST_REASON_REQUIRED/);
});

test("sales pipeline supports measurable stages, qualification, activities and next actions", async () => {
  const route = await readFile(routeUrl, "utf8");
  for (const stage of ["NEW","QUALIFIED","CONTACTED","DEMO_SCHEDULED","DEMO_COMPLETED","PROPOSAL_SENT","NEGOTIATION","WON","LOST","NURTURE"]) {
    assert.match(route, new RegExp(stage));
  }
  for (const qualification of ["UNQUALIFIED","MQL","SQL","DISQUALIFIED"]) {
    assert.match(route, new RegExp(qualification));
  }
  for (const activity of ["CALL","EMAIL","WHATSAPP","MEETING","DEMO","PROPOSAL","NOTE"]) {
    assert.match(route, new RegExp(activity));
  }
  assert.match(route, /nextFollowUpAt/);
  assert.match(route, /expectedAnnualValuePaise/);
  assert.match(route, /winRate/);
  assert.match(route, /bySource/);
});

test("platform UI exposes SaaS Sales only as a platform navigation surface", async () => {
  const [sidebar, page] = await Promise.all([readFile(sidebarUrl, "utf8"), readFile(pageUrl, "utf8")]);
  assert.match(sidebar, /SaaS Sales.*platformOnly: true/);
  assert.match(page, /\/platform\/sales\/dashboard/);
  assert.match(page, /\/platform\/sales\/leads/);
  assert.match(page, /Add target account/);
  assert.match(page, /Log activity/);
  assert.match(page, /Overdue/);
  assert.match(page, /Win rate/);
});

test("Step 10 playbook defines ICPs, sources, cadence, qualification, demo, KPI and handoff controls", async () => {
  const playbook = await readFile(playbookUrl, "utf8");
  for (const phrase of [
    "ideal customer profiles",
    "CBSE SARAS",
    "CISCE School Locator",
    "Standard outbound cadence",
    "SQL",
    "Demo workflow",
    "Launch KPI baseline",
    "wonOrganizationId",
    "Step 7 Client Onboarding",
    "Do not buy unverified personal-data lists",
  ]) assert.match(playbook, new RegExp(phrase, "i"));
});
