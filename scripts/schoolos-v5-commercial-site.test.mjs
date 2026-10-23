import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pagePath = new URL("../apps/web/app/schoolos/page.tsx", import.meta.url);
const formPath = new URL("../apps/web/components/schoolos-interest-form.tsx", import.meta.url);
const page = await readFile(pagePath, "utf8");
const form = await readFile(formPath, "utf8");

test("the V5 prospect route is private preview, not indexed public GA", () => {
  assert.match(page, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false/);
  assert.match(page, /Private demonstrations/);
  assert.match(page, /not a subscription or a payment/);
  assert.match(page, /SchoolOSInterestForm/);
});

test("SchoolOS leads are captured in the existing protected CRM, not a parallel store", () => {
  assert.match(form, /\/public\/saas-sales\/leads/);
  assert.match(form, /source:\s*"WEBSITE"/);
  assert.match(form, /campaign:\s*"SCHOOLOS_V5_PRIVATE_DEMO"/);
  assert.match(form, /intent:\s*"B2B_PRODUCT_DEMO"/);
  assert.match(form, /product:\s*"ADHYAY_SCHOOLOS"/);
  assert.match(form, /contactConsent/);
  assert.match(form, /mobile/);
  assert.doesNotMatch(form, /\/checkout|\/subscribe|\/payments\/|localStorage|paymentMethod/);
});

test("sales page does not promise unverifiable commercial availability", () => {
  assert.match(page, /Commercial preview only/);
  assert.match(page, /Pricing and implementation are confirmed only after a workflow audit/);
  assert.doesNotMatch(page, /100% ready|ISO.?27001 certified|unlimited (?:AI|video)|guaranteed launch/i);
});

test("CRM request uses exactly one authenticated-free POST and records no card or student personal details", () => {
  assert.match(form, /method:\s*"POST"/);
  assert.match(form, /JSON\.stringify\(/);
  assert.match(form, /No card details or payment are requested/);
  assert.doesNotMatch(form, /studentName|aadhaar|cardNumber|cvv|creditCard/);
});
