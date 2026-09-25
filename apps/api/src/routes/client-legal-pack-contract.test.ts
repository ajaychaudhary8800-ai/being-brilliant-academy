import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const doc = (name: string) => new URL(`../../../../docs/legal-sales/${name}`, import.meta.url);

test("Step 9 client legal pack contains all controlled sales and contracting documents", async () => {
  const names = [
    "README.md",
    "01_SALES_PROPOSAL_TEMPLATE.md",
    "02_QUOTATION_ORDER_FORM_TEMPLATE.md",
    "03_SAAS_SUBSCRIPTION_AGREEMENT_TEMPLATE.md",
    "04_SERVICE_LEVEL_AGREEMENT_TEMPLATE.md",
    "05_DATA_PROCESSING_ADDENDUM_TEMPLATE.md",
    "06_IMPLEMENTATION_SOW_TEMPLATE.md",
    "07_UAT_GO_LIVE_SIGNOFF_TEMPLATE.md",
    "08_HANDOVER_SUPPORT_ACCEPTANCE_TEMPLATE.md",
    "09_CLIENT_PRIVACY_NOTICE_GUIDANCE.md",
  ];
  for (const name of names) {
    const content = await readFile(doc(name), "utf8");
    assert.ok(content.length > 500, `${name} must remain a substantive controlled document`);
  }
});

test("commercial and legal documents preserve plan enforcement and written scope control", async () => {
  const [order, agreement, sow, handover] = await Promise.all([
    readFile(doc("02_QUOTATION_ORDER_FORM_TEMPLATE.md"), "utf8"),
    readFile(doc("03_SAAS_SUBSCRIPTION_AGREEMENT_TEMPLATE.md"), "utf8"),
    readFile(doc("06_IMPLEMENTATION_SOW_TEMPLATE.md"), "utf8"),
    readFile(doc("08_HANDOVER_SUPPORT_ACCEPTANCE_TEMPLATE.md"), "utf8"),
  ]);
  assert.match(order, /active-student limit/i);
  assert.match(order, /platform plan\/override/i);
  assert.match(agreement, /technically enforce limits/i);
  assert.match(agreement, /Change Order/i);
  assert.match(sow, /Change Request/i);
  assert.match(handover, /plan limits and module entitlements/i);
});

test("data terms define client fiduciary, provider processor, breach cooperation and DPDP transition", async () => {
  const dpa = await readFile(doc("05_DATA_PROCESSING_ADDENDUM_TEMPLATE.md"), "utf8");
  assert.match(dpa, /Data Fiduciary/);
  assert.match(dpa, /Data Processor/);
  assert.match(dpa, /without undue delay/i);
  assert.match(dpa, /children/i);
  assert.match(dpa, /phased commencement/i);
  assert.match(dpa, /as and when they are in force/i);
});

test("SLA has measurable availability, response targets and exclusions without pretending resolution guarantees", async () => {
  const sla = await readFile(doc("04_SERVICE_LEVEL_AGREEMENT_TEMPLATE.md"), "utf8");
  assert.match(sla, /99\.5%/);
  assert.match(sla, /P1 Critical/);
  assert.match(sla, /1 business hour/);
  assert.match(sla, /Response target means acknowledgement\/triage start, not guaranteed resolution time/);
  assert.match(sla, /third-party/i);
});

test("UAT and handover prevent silent production acceptance", async () => {
  const [uat, handover] = await Promise.all([
    readFile(doc("07_UAT_GO_LIVE_SIGNOFF_TEMPLATE.md"), "utf8"),
    readFile(doc("08_HANDOVER_SUPPORT_ACCEPTANCE_TEMPLATE.md"), "utf8"),
  ]);
  assert.match(uat, /Approved for production go-live/);
  assert.match(uat, /Not approved/);
  assert.match(uat, /blocking/i);
  assert.match(handover, /Temporary implementation credentials/);
  assert.match(handover, /Open items/);
});

test("master agreement permits electronic contracting and keeps negotiated liability explicit", async () => {
  const agreement = await readFile(doc("03_SAAS_SUBSCRIPTION_AGREEMENT_TEMPLATE.md"), "utf8");
  assert.match(agreement, /Electronic contracting/);
  assert.match(agreement, /12 months preceding the event/);
  assert.match(agreement, /Arbitration and Conciliation Act, 1996/);
  assert.match(agreement, /Ghaziabad, Uttar Pradesh/);
});
