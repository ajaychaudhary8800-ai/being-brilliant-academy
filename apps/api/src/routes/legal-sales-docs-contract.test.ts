import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const legal = (name: string) => new URL(`../../../../docs/legal-sales/${name}`, import.meta.url);

test("Step 9 legal-sales pack contains the complete controlled document set", async () => {
  const expected = [
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
  ];
  for (const file of expected) {
    const source = await readFile(legal(file), "utf8");
    assert.ok(source.length > 400, `${file} must contain substantive controlled content`);
  }
});

test("Order Form and proposal remain anchored to the approved Step 8 commercial catalogue", async () => {
  const [proposal, order] = await Promise.all([
    readFile(legal("01_SALES_PROPOSAL_TEMPLATE.md"), "utf8"),
    readFile(legal("02_ORDER_FORM_QUOTATION.md"), "utf8"),
  ]);
  assert.match(proposal, /ESSENTIALS \/ GROWTH \/ PROFESSIONAL \/ ENTERPRISE/);
  assert.match(proposal, /COMMERCIAL_PACKAGING_PRICING\.md/);
  assert.match(order, /COMMERCIAL_PACKAGING_PRICING\.md/);
  assert.match(order, /GST:\*\* as applicable/);
  assert.match(order, /reflected in the platform plan\/entitlement configuration/);
});

test("Master agreement contains core SaaS risk allocation and Indian dispute framework", async () => {
  const msa = await readFile(legal("03_SAAS_MASTER_AGREEMENT.md"), "utf8");
  assert.match(msa, /Client retains its rights in Client Data/);
  assert.match(msa, /Provider will not sell Client Data/);
  assert.match(msa, /twelve months preceding the event/);
  assert.match(msa, /Digital Personal Data Protection Act, 2023/);
  assert.match(msa, /Arbitration and Conciliation Act, 1996/);
  assert.match(msa, /seat of arbitration will be \*\*New Delhi, India\*\*/);
});

test("DPA is DPDP-ready without misallocating institution-controlled student obligations", async () => {
  const dpa = await readFile(legal("06_DATA_PROCESSING_ADDENDUM.md"), "utf8");
  assert.match(dpa, /Client to act as the relevant Data Fiduciary\/controller/);
  assert.match(dpa, /Provider to act as Data Processor\/processor/);
  assert.match(dpa, /verifiable parental\/guardian consent/);
  assert.match(dpa, /target notification within 24 hours after confirming/);
  assert.match(dpa, /phased commencement/);
  assert.match(dpa, /Client must not assume India-only data residency/);
});

test("SLA reflects verified off-site backup evidence without over-promising recovery commitments", async () => {
  const sla = await readFile(legal("05_SLA_SUPPORT_POLICY.md"), "utf8");
  assert.match(sla, /99\.5% per calendar month/);
  assert.match(sla, /Service Credit SLA: Included/);
  assert.match(sla, /Cloudflare R2 off-site backup procedures/);
  assert.match(sla, /does not make a fixed contractual RPO\/RTO/);
  assert.match(sla, /\+91 92663 41098/);
  assert.match(sla, /Monday-Saturday, 9:00 AM-6:00 PM IST/);
  assert.match(sla, /P1 \| 2 business hours/);
});

test("privacy, exit and security schedules preserve truthful customer commitments", async () => {
  const [privacy, exit, security] = await Promise.all([
    readFile(legal("07_PRIVACY_NOTICE.md"), "utf8"),
    readFile(legal("09_DATA_EXIT_RETENTION.md"), "utf8"),
    readFile(legal("10_SECURITY_SCHEDULE.md"), "utf8"),
  ]);
  assert.match(privacy, /We do not sell institution-controlled personal data/);
  assert.match(privacy, /privacy@beingbrilliantedu\.com/);
  assert.match(privacy, /activated and inbound delivery was verified on 6 October 2026/);
  assert.match(exit, /30-day exit window/);
  assert.match(exit, /60 days after the exit window closes/);
  assert.match(security, /does not claim certifications that have not been obtained/);
  assert.match(security, /No implied certification/);
  assert.match(security, /off-site DR commitments are not represented/);
});


test("provider execution particulars use public-safe business contacts", async () => {
  const execution = await readFile(legal("EXECUTION_PARTICULARS.md"), "utf8");
  assert.match(execution, /U80100UP2017PTC089682/);
  assert.match(execution, /09AAPCA1080N2Z7/);
  assert.match(execution, /GST registration type:\*\* Regular/);
  assert.match(execution, /GST registration valid from:\*\* 17\/12\/2024/);
  assert.match(execution, /GST certificate issue date:\*\* 17\/12\/2024/);
  assert.match(execution, /Royal Green City Phase 2/);
  assert.match(execution, /Verified from official GST REG-06 certificate/);
  assert.match(execution, /CHOUDHARY AJAY SINGH HOON/);
  assert.match(execution, /KH NO 257 PLOT NO 26 ROYAL GREEN CITY, PHASE II VILL DUHAI/);
  assert.match(execution, /ROC Kanpur/);
  assert.match(execution, /03\/02\/2017/);
  assert.match(execution, /legal@beingbrilliantedu\.com/);
  assert.match(execution, /privacy@beingbrilliantedu\.com/);
  assert.match(execution, /support@beingbrilliantedu\.com/);
  assert.match(execution, /\+91 92663 41098/);
  assert.match(execution, /SPF PASS/);
  assert.match(execution, /DKIM PASS/);
  assert.match(execution, /DMARC PASS/);
  assert.doesNotMatch(execution, /@gmail\.com/i);
  assert.match(execution, /Bank account and payment destination details are not stored in source control/);
});

test("counsel approval record captures completed no-change legal review", async () => {
  const approval = await readFile(legal("COUNSEL_APPROVAL_RECORD.md"), "utf8");
  assert.match(approval, /APPROVED WITHOUT CHANGES/);
  assert.match(approval, /Approved for external customer signature:\*\* YES/);
  assert.match(approval, /Approved for public Privacy Notice publication:\*\* YES/);
  assert.match(approval, /Approved for public SaaS Terms publication:\*\* YES/);
  assert.match(approval, /Approved for public Acceptable Use Policy publication:\*\* YES/);
  assert.match(approval, /Counsel amendments implemented:\*\* NOT REQUIRED/);
  assert.match(approval, /Legal-execution gate decision:\*\* READY/);
  assert.match(approval, /private correspondence itself is not committed/i);
});
