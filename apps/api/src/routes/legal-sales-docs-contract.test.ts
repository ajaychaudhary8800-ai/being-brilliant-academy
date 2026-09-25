import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const legal = (name: string) => new URL(`../../../../docs/legal-sales/${name}`, import.meta.url);

test("Step 9 legal-sales pack contains the complete controlled document set", async () => {
  const expected = [
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

test("SLA does not promise unverified off-site disaster recovery", async () => {
  const sla = await readFile(legal("05_SLA_SUPPORT_POLICY.md"), "utf8");
  assert.match(sla, /99\.5% per calendar month/);
  assert.match(sla, /Service Credit SLA: Included/);
  assert.match(sla, /No off-site backup RPO\/RTO or isolated disaster-recovery restoration commitment/);
  assert.match(sla, /P1 \| 2 business hours/);
});

test("privacy, exit and security schedules preserve truthful customer commitments", async () => {
  const [privacy, exit, security] = await Promise.all([
    readFile(legal("07_PRIVACY_NOTICE.md"), "utf8"),
    readFile(legal("09_DATA_EXIT_RETENTION.md"), "utf8"),
    readFile(legal("10_SECURITY_SCHEDULE.md"), "utf8"),
  ]);
  assert.match(privacy, /We do not sell institution-controlled personal data/);
  assert.ok(privacy.includes("INSERT VERIFIED PRIVACY CONTACT BEFORE PUBLICATION"));
  assert.match(exit, /30-day exit window/);
  assert.match(exit, /60 days after the exit window closes/);
  assert.match(security, /does not claim certifications that have not been obtained/);
  assert.match(security, /No implied certification/);
  assert.match(security, /off-site DR commitments are not represented/);
});
