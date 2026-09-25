import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeUrl = new URL("./legal-sales-documents.ts", import.meta.url);
const serverUrl = new URL("../server.ts", import.meta.url);
const dockerUrl = new URL("../../Dockerfile", import.meta.url);
const sidebarUrl = new URL("../../../web/components/sidebar.tsx", import.meta.url);
const pageUrl = new URL("../../../web/app/admin/legal-sales/page.tsx", import.meta.url);
const readmeUrl = new URL("../../../../docs/legal-sales/README.md", import.meta.url);

test("platform legal sales workspace exposes the complete controlled Step 9 pack", async () => {
  const route = await readFile(routeUrl, "utf8");
  for (const file of [
    "README.md",
    "01_SALES_PROPOSAL_TEMPLATE.md",
    "02_ORDER_FORM_QUOTATION.md",
    "03_SAAS_MASTER_AGREEMENT.md",
    "04_IMPLEMENTATION_SOW.md",
    "05_SLA_SUPPORT_POLICY.md",
    "06_DATA_PROCESSING_ADDENDUM.md",
    "07_PRIVACY_NOTICE.md",
    "08_ACCEPTABLE_USE_POLICY.md",
    "09_DATA_EXIT_RETENTION.md",
    "10_SECURITY_SCHEDULE.md",
    "11_CLIENT_HANDOVER_ACCEPTANCE.md",
    "LEGAL_RESEARCH_NOTES.md",
  ]) {
    assert.ok(route.includes(file), `missing ${file}`);
  }
});

test("legal sales API is platform-only and cannot accept arbitrary document paths", async () => {
  const route = await readFile(routeUrl, "utf8");
  assert.match(route, /requireAuth/);
  assert.match(route, /homeOrganizationId !== "org_default"/);
  assert.match(route, /PLATFORM_ADMIN_REQUIRED/);
  assert.match(route, /documents\.find\(document => document\.id === id\)/);
  assert.match(route, /LEGAL_SALES_DOCUMENT_NOT_FOUND/);
  assert.doesNotMatch(route, /req\.params\.(?:file|path)/);
});

test("generation creates a working copy without writing over controlled files", async () => {
  const route = await readFile(routeUrl, "utf8");
  assert.match(route, /replacePlaceholders/);
  assert.match(route, /-working-copy\.md/);
  assert.match(route, /Working copy only\. The controlled source template remains unchanged\./);
  assert.doesNotMatch(route, /writeFile/);
  assert.match(route, /unresolvedPlaceholders/);
});

test("runtime API image packages the controlled legal sales source", async () => {
  const [docker, server] = await Promise.all([
    readFile(dockerUrl, "utf8"),
    readFile(serverUrl, "utf8"),
  ]);
  assert.match(docker, /COPY --chown=app:app docs\/legal-sales \.\/docs\/legal-sales/);
  assert.match(server, /legal-sales-documents\.js/);
  assert.match(server, /onlyPaths\(\["\/platform\/legal-sales"\], legalSalesDocuments\)/);
});

test("platform navigation and UI expose view, generate, download and print controls", async () => {
  const [sidebar, page] = await Promise.all([
    readFile(sidebarUrl, "utf8"),
    readFile(pageUrl, "utf8"),
  ]);
  assert.match(sidebar, /Sales Documents.*\/admin\/legal-sales.*platformOnly: true/);
  assert.match(page, /\/platform\/legal-sales\/documents/);
  assert.match(page, /Generate working copy/);
  assert.match(page, /Download/);
  assert.match(page, /Print \/ PDF/);
  assert.match(page, /Controlled source preview/);
  assert.match(page, /Editable working copy/);
  assert.match(page, /Indian counsel review/);
  assert.match(page, /Step 5 remains incomplete/);
});

test("Step 9 README points operators to the ERP workspace", async () => {
  const readme = await readFile(readmeUrl, "utf8");
  assert.match(readme, /\/admin\/legal-sales/);
  assert.match(readme, /Platform Super Admin/);
});
