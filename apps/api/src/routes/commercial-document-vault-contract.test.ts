import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeUrl = new URL("./commercial-document-vault.ts", import.meta.url);
const serverUrl = new URL("../server.ts", import.meta.url);
const schemaUrl = new URL("../../prisma/schema.prisma", import.meta.url);
const migrationUrl = new URL("../../prisma/migrations/20261008003000_saas_commercial_document_vault/migration.sql", import.meta.url);
const pageUrl = new URL("../../../web/app/admin/commercial-documents/page.tsx", import.meta.url);
const sidebarUrl = new URL("../../../web/components/sidebar.tsx", import.meta.url);
const legalSalesUrl = new URL("../../../web/app/admin/legal-sales/page.tsx", import.meta.url);

test("commercial vault has an auditable lead-linked persistence model", async () => {
  const [schema, migration] = await Promise.all([readFile(schemaUrl, "utf8"), readFile(migrationUrl, "utf8")]);
  assert.match(schema, /model SaaSCommercialDocument \{/);
  assert.match(schema, /leadId\s+String/);
  assert.match(schema, /organizationId\s+String\?/);
  assert.match(schema, /contentSha256\s+String/);
  assert.match(schema, /verificationStatus\s+String/);
  assert.match(schema, /fileData\s+Bytes/);
  assert.match(schema, /documents\s+SaaSCommercialDocument\[\]/);
  assert.match(migration, /CREATE TABLE "SaaSCommercialDocument"/);
  assert.match(migration, /FOREIGN KEY \("leadId"\) REFERENCES "SaaSSalesLead"/);
  assert.match(migration, /"contentSha256"/);
});

test("vault API is platform-only, validates PDF bytes and does not expose file blobs in listings", async () => {
  const [route, server] = await Promise.all([readFile(routeUrl, "utf8"), readFile(serverUrl, "utf8")]);
  assert.match(route, /PLATFORM_ADMIN_REQUIRED/);
  assert.match(route, /homeOrganizationId !== "org_default"/);
  assert.match(route, /z\.literal\("application\/pdf"\)/);
  assert.match(route, /assertDocumentFileExtension/);
  assert.match(route, /decodeVerifiedUpload/);
  assert.match(route, /10 \* 1024 \* 1024/);
  assert.match(route, /createHash\("sha256"\)/);
  assert.match(route, /COMMERCIAL_DOCUMENT_DUPLICATE/);
  assert.match(route, /fileData: _fileData/);
  assert.match(route, /Cache-Control", "no-store"/);
  assert.match(server, /commercial-document-vault\.js/);
  assert.match(server, /\/platform\/commercial-documents/);
});

test("vault supports the Step-11 commercial and go-live evidence categories", async () => {
  const route = await readFile(routeUrl, "utf8");
  for (const category of [
    "SIGNED_ORDER_FORM",
    "SIGNED_SAAS_AGREEMENT",
    "SIGNED_SOW",
    "SIGNED_DPA",
    "INVOICE",
    "PAYMENT_EVIDENCE",
    "UAT_ACCEPTANCE",
    "HANDOVER_ACCEPTANCE",
  ]) assert.match(route, new RegExp(category));
  assert.match(route, /verificationStatus: z\.enum\(\["VERIFIED", "REJECTED"\]\)/);
  assert.match(route, /archivedAt/);
  assert.doesNotMatch(route, /router\.delete/);
});

test("platform UI exposes upload, verification, download and signed-document navigation", async () => {
  const [page, sidebar, legalSales] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(sidebarUrl, "utf8"),
    readFile(legalSalesUrl, "utf8"),
  ]);
  assert.match(page, /Commercial Document Vault/);
  assert.match(page, /Store in vault/);
  assert.match(page, /application\/pdf/);
  assert.match(page, /\/platform\/commercial-documents/);
  assert.match(page, /Verify/);
  assert.match(page, /Download/);
  assert.match(page, /Archive/);
  assert.match(sidebar, /Commercial Vault.*\/admin\/commercial-documents.*platformOnly: true/);
  assert.match(legalSales, /\/admin\/commercial-documents/);
});
