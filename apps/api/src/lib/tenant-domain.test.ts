import assert from "node:assert/strict";
import test from "node:test";
import {
  customDomainFromSettings,
  normalizeTenantHost,
  platformWebHost,
  tenantPortalBaseUrl,
  tenantSlugFromHost,
} from "./tenant-domain.js";

test("tenant domains normalize host input without protocol, path, port, or trailing dot", () => {
  assert.equal(normalizeTenantHost("HTTPS://ERP.School.Example:443/path"), "erp.school.example");
  assert.equal(normalizeTenantHost("erp.school.example."), "erp.school.example");
  assert.equal(normalizeTenantHost(null), null);
});

test("tenant custom domain accepts normalized customer hostnames and rejects malformed values", () => {
  assert.equal(customDomainFromSettings({ whiteLabel: { customDomain: "erp.school.example" } }, true), "erp.school.example");
  assert.throws(
    () => customDomainFromSettings({ whiteLabel: { customDomain: "https://erp.school.example/login" } }, true),
    (error: any) => error?.code === "INVALID_CUSTOM_DOMAIN",
  );
});

test("platform subdomain resolution only accepts a single slug label beneath the configured web host", () => {
  const base = platformWebHost();
  assert.ok(base);
  assert.equal(tenantSlugFromHost(base), null);
  assert.equal(tenantSlugFromHost(`school-one.${base}`), "school-one");
  assert.equal(tenantSlugFromHost(`nested.school-one.${base}`), null);
  assert.equal(tenantSlugFromHost("unrelated.example"), null);
  assert.equal(tenantSlugFromHost(`api.${base}`), null);
});

test("tenant portal links prefer a configured custom domain and otherwise stay on the shared deployment", () => {
  assert.equal(tenantPortalBaseUrl({ whiteLabel: { customDomain: "erp.school.example" } }), "https://erp.school.example");
  assert.match(tenantPortalBaseUrl({}), /^https?:\/\//);
});
