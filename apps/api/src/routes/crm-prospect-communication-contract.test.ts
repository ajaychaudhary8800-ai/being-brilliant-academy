import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("CRM prospect communications are persisted with creator audit relations", async () => {
  const [schema,migration] = await Promise.all([
    readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../../prisma/migrations/20260927090000_crm_prospect_communications/migration.sql", import.meta.url), "utf8"),
  ]);

  assert.match(schema, /model EnquiryCommunication/);
  assert.match(schema, /communications\s+EnquiryCommunication\[\]/);
  assert.match(schema, /enquiryCommunications\s+EnquiryCommunication\[\]\s+@relation\("EnquiryCommunicationCreator"\)/);
  assert.match(schema, /createdBy\s+User\?\s+@relation\("EnquiryCommunicationCreator"/);
  assert.match(schema, /organizationId\s+String\s+@default\("org_default"\)/);
  assert.match(schema, /enquiry\s+Enquiry\s+@relation\(fields: \[enquiryId\], references: \[id\], onDelete: Cascade\)/);
  assert.match(schema, /@@index\(\[enquiryId, createdAt\]\)/);
  assert.match(migration, /CREATE TABLE "EnquiryCommunication"/);
  assert.match(migration, /FOREIGN KEY \("enquiryId"\) REFERENCES "Enquiry"\("id"\)/);
  assert.match(migration, /EnquiryCommunication_createdById_fkey/);
  assert.match(migration, /FOREIGN KEY \("createdById"\) REFERENCES "User"\("id"\)/);
});

test("CRM prospect delivery supports email, SMS and WhatsApp with audit history", async () => {
  const [route,notifications] = await Promise.all([
    readFile(new URL("admin-enquiries.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/notifications.ts", import.meta.url), "utf8"),
  ]);
  const start = route.indexOf('router.post("/enquiries/:id/communications"');
  const end = route.indexOf('router.post("/enquiries/:id/follow-ups"', start);
  assert.ok(start >= 0 && end > start);
  const block = route.slice(start, end);

  assert.match(route, /\/enquiries\/communication-capabilities/);
  assert.match(route, /providerStatus\(\)/);
  assert.match(route, /const detailSelect=\{\.\.\.select,communications:\{include:\{createdBy:/);
  assert.match(route, /select:detailSelect/);
  assert.match(block, /assertEnquiryEditable\(enquiry\.status\)/);
  assert.match(block, /z\.enum\(\["EMAIL","SMS","WHATSAPP"\]\)/);
  assert.match(block, /ENQUIRY_EMAIL_REQUIRED/);
  assert.match(block, /ENQUIRY_MOBILE_REQUIRED/);
  assert.match(block, /sendExternalMessage/);
  assert.match(block, /status:"PENDING"/);
  assert.match(block, /status:"SENT"/);
  assert.match(block, /status:"SKIPPED"/);
  assert.match(block, /status:"FAILED"/);
  assert.match(block, /CRM_PROSPECT_COMMUNICATION_SENT/);
  assert.match(block, /CRM_PROSPECT_COMMUNICATION_ATTEMPTED/);
  assert.match(block, /updatedAt:new Date\(\)/);

  assert.match(notifications, /export type ExternalMessageChannel = "EMAIL" \| "SMS" \| "WHATSAPP"/);
  assert.match(notifications, /export async function sendExternalMessage/);
  assert.match(notifications, /channel === "EMAIL"/);
  assert.match(notifications, /channel === "SMS"/);
  assert.match(notifications, /sendWhatsapp\(to, body\)/);
});

test("Admissions CRM exposes a multi-channel contact action and unified activity timeline", async () => {
  const page = await readFile(new URL("../../../web/app/admin/enquiries/page.tsx", import.meta.url), "utf8");

  assert.match(page, /mode.*"communicate"/);
  assert.match(page, /communications\?:EnquiryCommunication\[\]/);
  assert.match(page, /communication-capabilities/);
  assert.match(page, /\/communications/);
  assert.match(page, /function CommunicationForm/);
  assert.match(page, /Contact Prospect/);
  assert.match(page, /WhatsApp/);
  assert.match(page, /Activity Timeline/);
  assert.match(page, /selected!\.communications\?\?\[\]/);
  assert.match(page, /createdBy\?\.name/);
  assert.match(page, />Contact<\/button>/);
  assert.match(page, /Record follow-up/);
});
