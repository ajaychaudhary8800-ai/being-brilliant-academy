import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeUrl = new URL("./legal-sales-documents.ts", import.meta.url);
const serverUrl = new URL("../server.ts", import.meta.url);
const dockerUrl = new URL("../../Dockerfile", import.meta.url);
const sidebarUrl = new URL("../../../web/components/sidebar.tsx", import.meta.url);
const pageUrl = new URL("../../../web/app/admin/legal-sales/page.tsx", import.meta.url);
const readmeUrl = new URL("../../../../docs/legal-sales/README.md", import.meta.url);
const orderFormUrl = new URL("../../../../docs/legal-sales/02_ORDER_FORM_QUOTATION.md", import.meta.url);
const sowUrl = new URL("../../../../docs/legal-sales/04_IMPLEMENTATION_SOW.md", import.meta.url);
const handoverUrl = new URL("../../../../docs/legal-sales/11_CLIENT_HANDOVER_ACCEPTANCE.md", import.meta.url);

test("platform legal sales workspace exposes the complete controlled Step 9 pack", async () => {
  const route = await readFile(routeUrl, "utf8");
  for (const file of [
    "README.md",
    "EXECUTION_PARTICULARS.md",
    "COUNSEL_REVIEW_HANDOFF.md",
    "COUNSEL_APPROVAL_RECORD.md",
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
  const route = await readFile(routeUrl, "utf8");
  assert.match(route, /\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/docs\/legal-sales/);
  assert.match(route, /LEGAL_SALES_SOURCE_UNAVAILABLE/);
  assert.match(server, /legal-sales-documents\.js/);
  assert.match(server, /onlyPaths\(\["\/platform\/legal-sales"\], legalSalesDocuments\)/);
});

test("client proposal print hides internal guidance and zero-value add-on rows", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /line\.includes\("docs\/COMMERCIAL_PACKAGING_PRICING\.md"\)/);
  assert.match(page, /line\.startsWith\("\*\*Payment particulars control:\*\*"\)/);
  assert.match(page, /clientTitle = line\.slice\(2\)\.replace/);
  assert.match(page, /visibleRows = rows\.filter/);
  assert.match(page, /role="status"/);
  assert.match(page, /section\.card>header/);
});

test("legal sales print output renders client-facing markdown without admin chrome", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /function PrintableMarkdown/);
  assert.match(page, /legal-sales-print-document/);
  assert.match(page, /print-table/);
  assert.match(page, /admin-workspace-main>div>header/);
  assert.doesNotMatch(page, /<pre className="legal-sales-print-content/);
});

test("order form and SOW use unambiguous client-generation placeholders", async () => {
  const [orderForm, sow] = await Promise.all([
    readFile(orderFormUrl, "utf8"),
    readFile(sowUrl, "utf8"),
  ]);
  for (const token of [
    "ORDER NUMBER",
    "EFFECTIVE DATE",
    "SUBSCRIPTION START",
    "TARGET GO-LIVE",
    "ACTIVE STUDENT CAPACITY",
    "ACTIVE USER CAPACITY",
    "BRANCH CAPACITY",
    "SUBSCRIPTION AMOUNT",
    "IMPLEMENTATION AMOUNT",
    "IMPLEMENTATION FREQUENCY",
    "DATA MIGRATION AMOUNT",
    "DATA MIGRATION FREQUENCY",
    "INTEGRATION ADD-ON AMOUNT",
    "INTEGRATION ADD-ON FREQUENCY",
    "SUBTOTAL",
    "CLIENT SIGNATORY NAME",
  ]) assert.match(orderForm, new RegExp("\\\[\\\[" + token + "\\\]\\\]"));
  for (const token of [
    "ORDER NUMBER",
    "TARGET GO-LIVE",
    "BRANCH CAPACITY",
    "ACADEMIC CONFIGURATION SCOPE",
    "MIGRATION INCLUDED",
    "MIGRATION SOURCES",
    "MIGRATION OBJECTS",
    "UAT FEEDBACK DAYS",
    "PROVIDER PROJECT CONTACT",
    "CLIENT PROJECT CONTACT",
    "GOVERNANCE CADENCE",
  ]) assert.match(sow, new RegExp("\\\[\\\[" + token + "\\\]\\\]"));
  assert.doesNotMatch(orderForm, /\[\[(?:NUMBER|AMOUNT|DATE)\]\]/);
  assert.doesNotMatch(sow, /\[\[(?:NUMBER|DATE|NAME\/EMAIL)\]\]/);
});

test("order form client PDF cannot be exported with unresolved placeholders and excluded services are explicit", async () => {
  const [page, orderForm] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(orderFormUrl, "utf8"),
  ]);
  assert.match(page, /const printBlocked = Boolean\(detail\?\.generationEnabled && \(!workingContent \|\| unresolved\.length > 0\)\)/);
  assert.match(page, /Client PDF export stays disabled until the working copy has no unresolved placeholders/);
  assert.match(page, /\["DATA MIGRATION AMOUNT", selectedPlan \? "N\/A" : ""\]/);
  assert.match(page, /\["DATA MIGRATION FREQUENCY", selectedPlan \? "Not included" : ""\]/);
  assert.match(page, /\["INTEGRATION ADD-ON FREQUENCY", selectedPlan \? "Not included" : ""\]/);
  assert.match(page, /print-signature-table/);
  assert.match(orderForm, /\[\[DATA MIGRATION FREQUENCY\]\]/);
  assert.match(orderForm, /\[\[INTEGRATION ADD-ON FREQUENCY\]\]/);
  assert.match(orderForm, /\| Acceptance \| Provider \| Client \|/);
});

test("implementation SOW prefills standard no-migration defaults without inventing client dates or contacts", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /\["ACADEMIC CONFIGURATION SCOPE", selectedPlan \? "Standard academic-session, branch\/campus, class\/course, section\/batch, subject, role and entitled-module configuration" : ""\]/);
  assert.match(page, /\["MIGRATION INCLUDED", selectedPlan \? "NO" : ""\]/);
  assert.match(page, /\["MIGRATION SOURCES", selectedPlan \? "Not applicable — legacy data migration is excluded unless separately contracted" : ""\]/);
  assert.match(page, /\["MIGRATION OBJECTS", selectedPlan \? "Not applicable" : ""\]/);
  assert.match(page, /\["MIGRATION TRANSFORMATION DETAILS", selectedPlan \? "Not applicable" : ""\]/);
  assert.doesNotMatch(page, /\["TARGET GO-LIVE", selectedPlan/);
  assert.doesNotMatch(page, /\["CLIENT PROJECT CONTACT", selectedPlan/);
  assert.doesNotMatch(page, /\["PROVIDER PROJECT CONTACT", selectedPlan/);
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
  assert.match(page, /Step 5 off-site DR evidence is complete/);
  assert.match(page, /business-role mailboxes/);
});

test("Step 9 README points operators to the ERP workspace", async () => {
  const readme = await readFile(readmeUrl, "utf8");
  assert.match(readme, /\/admin\/legal-sales/);
  assert.match(readme, /Platform Super Admin/);
});


test("handover acceptance requires actual go-live facts and avoids generic placeholders", async () => {
  const [handover, page] = await Promise.all([
    readFile(handoverUrl, "utf8"),
    readFile(pageUrl, "utf8"),
  ]);
  for (const token of [
    "CLIENT LEGAL NAME",
    "INSTITUTION",
    "ORDER NUMBER",
    "GO LIVE DATE",
    "PLAN",
    "OPEN GO-LIVE EXCEPTIONS",
  ]) assert.match(handover, new RegExp("\\[\\[" + token + "\\]\\]"));
  assert.doesNotMatch(handover, /\[\[(?:NUMBER|DATE|NONE \/ LIST WITH OWNER AND TARGET)\]\]/);
  assert.doesNotMatch(page, /\["GO LIVE DATE", context\.documentDate/);
  assert.doesNotMatch(page, /\["GO LIVE DATE", context\.targetGoLive/);
  assert.doesNotMatch(page, /\["OPEN GO-LIVE EXCEPTIONS",/);
});
