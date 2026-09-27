import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("CRM prospect communications are persisted and tenant-scoped", async () => {
  const [schema,migration] = await Promise.all([
    readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../../prisma/migrations/20260927090000_crm_prospect_communications/migration.sql", import.meta.url), "utf8"),
  ]);

  assert.match(schema, /model EnquiryCommunication/);
  assert.match(schema, /communications\s+EnquiryCommunication\[\]/);
  assert.match(schema, /organizationId\s+String\s+@default\("org_default"\)/);
  assert.match(schema, /enquiry\s+Enquiry\s+@relation\(fields: \[enquiryId\], references: \[id\], onDelete: Cascade\)/);
  assert.match(schema, /@@index\(\[enquiryId, createdAt\]\)/);
  assert.match(migration, /CREATE TABLE "EnquiryCommunication"/);
  assert.match(migration, /FOREIGN KEY \("enquiryId"\) REFERENCES "Enquiry"\("id"\)/);
});

test("CRM prospect email delivery is audited and returned in enquiry details", async () => {
  const route = await readFile(new URL("admin-enquiries.ts", import.meta.url), "utf8");
  const start = route.indexOf('router.post("/enquiries/:id/communications/email"');
  const end = route.indexOf('router.post("/enquiries/:id/follow-ups"', start);
  assert.ok(start >= 0 && end > start);
  const block = route.slice(start, end);

  assert.match(route, /const detailSelect=\{\.\.\.select,communications:/);
  assert.match(route, /select:detailSelect/);
  assert.match(block, /assertEnquiryEditable\(enquiry\.status\)/);
  assert.match(block, /ENQUIRY_EMAIL_REQUIRED/);
  assert.match(block, /sendEmail\(enquiry\.email,input\.subject,input\.body\)/);
  assert.match(block, /status:"PENDING"/);
  assert.match(block, /status:"SENT"/);
  assert.match(block, /status:"SKIPPED"/);
  assert.match(block, /status:"FAILED"/);
  assert.match(block, /CRM_PROSPECT_EMAIL_SENT/);
  assert.match(block, /CRM_PROSPECT_EMAIL_ATTEMPTED/);
  assert.match(block, /updatedAt:new Date\(\)/);
});

test("Admissions CRM exposes prospect email actions and unified activity timeline", async () => {
  const page = await readFile(new URL("../../../web/app/admin/enquiries/page.tsx", import.meta.url), "utf8");

  assert.match(page, /mode.*"email"/);
  assert.match(page, /communications\?:EnquiryCommunication\[\]/);
  assert.match(page, /communications\/email/);
  assert.match(page, /Prospect email sent and recorded in the CRM timeline/);
  assert.match(page, /function EmailForm/);
  assert.match(page, /Email Prospect/);
  assert.match(page, /Activity Timeline/);
  assert.match(page, /selected!\.communications\?\?\[\]/);
  assert.match(page, /Record follow-up/);
});
