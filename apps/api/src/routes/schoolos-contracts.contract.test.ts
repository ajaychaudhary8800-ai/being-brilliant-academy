import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("contract binding requires independently verified encrypted document and same organization", async () => {
  const r = await readFile(new URL("schoolos-contracts.ts", import.meta.url), "utf8");
  assert.match(r, /documentType !== "SIGNED_ORDER_FORM"/);
  assert.match(r, /document\.verificationStatus !== "VERIFIED"/);
  assert.match(r, /document\.uploadedById === document\.verifiedById/);
  assert.match(r, /document\.lead\.wonOrganizationId !== quote\.organizationId/);
  assert.match(r, /document\.documentReference !== quote\.quoteNo/);
  assert.match(r, /document\.signedAt > quote\.validUntil/);
  assert.match(r, /quote\.totalPaise !== input\.confirmedTotalPaise/);
  assert.match(r, /paymentCollected: false, subscriptionActivated: false/);
  assert.doesNotMatch(r, /saaSSubscription\.(?:update|upsert)/);
  assert.doesNotMatch(r, /saaSInvoice\.(?:update|create)/);
});
test("binding is version fenced, audited and keeps the evidence document immutable", async () => {
  const r = await readFile(new URL("schoolos-contracts.ts", import.meta.url), "utf8");
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = await readFile(new URL("../../prisma/migrations/20261018200000_schoolos_quote_contract_evidence/migration.sql", import.meta.url), "utf8");
  assert.match(r, /status: "INTERNALLY_APPROVED", version: input\.expectedVersion/);
  assert.match(r, /SCHOOLOS_VERIFIED_ORDER_BOUND/);
  assert.match(schema, /contractDocumentId\s+String\?\s+@unique/);
  assert.match(migration, /ADD CONSTRAINT "SchoolOSQuotation_contractDocumentId_fkey"/);
  assert.doesNotMatch(migration, /ALTER TABLE "SaaSSubscription"/);
});
