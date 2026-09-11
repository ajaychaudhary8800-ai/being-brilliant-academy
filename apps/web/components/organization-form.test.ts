import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { defaultOrganizationTimezone, organizationCreationCopy, organizationGroupTerminologyOptions, organizationNameUpdate, organizationSlug } from "./organization-form";

test("organization creation uses neutral wording and the current Indian timezone", () => {
  assert.equal(organizationCreationCopy.heading, "Add New Organization");
  assert.equal(organizationCreationCopy.submit, "Create Organization");
  assert.equal(defaultOrganizationTimezone, "Asia/Kolkata");
});

test("organization slugs are lowercase and URL safe", () => {
  assert.equal(organizationSlug("QA Test Academy"), "qa-test-academy");
  assert.equal(organizationSlug("  Brilliant School & Academy!  "), "brilliant-school-academy");
});

test("organization name auto-generates a slug until it is manually overridden", () => {
  assert.equal(organizationNameUpdate({ name: "", slug: "" }, "Bright Future", false, false).slug, "bright-future");
  assert.equal(organizationNameUpdate({ name: "Bright", slug: "my-campus" }, "Bright Future", true, false).slug, "my-campus");
  assert.equal(organizationNameUpdate({ name: "Bright", slug: "existing" }, "Bright Future", false, true).slug, "existing");
});

test("organization creation exposes group terminology without treating it as institution type", () => {
  assert.deepEqual(organizationGroupTerminologyOptions, [
    ["SECTION", "Section"],
    ["BATCH", "Batch"],
    ["GROUP", "Group"],
    ["CUSTOM", "Custom label"],
  ]);
  const page = readFileSync(new URL("../app/admin/organizations/page.tsx", import.meta.url), "utf8");
  assert.match(page, /label="Academic group terminology"/);
  assert.match(page, /label="Custom group label"/);
  assert.doesNotMatch(page, /label="Institution type"/);
});
