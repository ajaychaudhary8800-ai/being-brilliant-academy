import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("CRM 3.0 release contract preserves the complete admissions workflow", async () => {
  const [route,page,policy,conversion,communications,counsellor] = await Promise.all([
    readFile(new URL("admin-enquiries.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../web/app/admin/enquiries/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/enquiry-policy.ts", import.meta.url), "utf8"),
    readFile(new URL("crm-conversion-onboarding-contract.test.ts", import.meta.url), "utf8"),
    readFile(new URL("crm-prospect-communication-contract.test.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/enquiry-counsellor-policy.ts", import.meta.url), "utf8"),
  ]);

  // Core pipeline, dashboard, intelligence and action center.
  assert.match(route, /\/enquiries\/dashboard/);
  assert.match(route, /\/enquiries\/insights/);
  assert.match(route, /\/enquiries\/action-center/);
  assert.match(page, /CRM Intelligence/);
  assert.match(page, /Follow-up Action Center/);

  // Tenant and branch scoping.
  assert.match(route, /organizationId:req\.auth!\.organizationId/);
  assert.match(route, /await access\(req,enquiry\.branchId\)/);
  assert.match(counsellor, /COUNSELLOR_BRANCH_MISMATCH/);

  // Follow-up workflow and terminal protections.
  assert.match(route, /\/enquiries\/:id\/follow-ups/);
  assert.match(policy, /ENQUIRY_CONVERTED/);
  assert.match(policy, /ENQUIRY_ARCHIVED/);
  assert.match(policy, /ENQUIRY_CONVERSION_WORKFLOW_REQUIRED/);

  // Secure conversion and academic placement.
  assert.match(route, /\/enquiries\/:id\/convert/);
  assert.match(route, /issueAccountSetup/);
  assert.match(route, /createActiveAcademicEnrollment/);
  assert.match(conversion, /secure account setup/);

  // External prospect communications and activity history.
  assert.match(route, /\/enquiries\/:id\/communications/);
  assert.match(route, /sendExternalMessage/);
  assert.match(page, /Contact Prospect/);
  assert.match(page, /Activity Timeline/);
  assert.match(communications, /EMAIL/);
  assert.match(communications, /SMS/);
  assert.match(communications, /WHATSAPP/);

  // Export and reporting remain available.
  assert.match(route, /\/enquiries\/export/);
  assert.match(page, />PDF<\/button>/);
  assert.match(page, />Excel<\/button>/);
});
