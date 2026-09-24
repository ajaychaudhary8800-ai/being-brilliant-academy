import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public branding exposes only the sanitized tenant brand contract", async () => {
  const source = await readFile(new URL("./public-branding.ts", import.meta.url), "utf8");
  assert.match(source, /router\.get\("\/branding"/);
  assert.match(source, /organizationId:/);
  assert.match(source, /whiteLabelSettings/);
  assert.match(source, /where: \{ isActive: true, deletedAt: null, settings: \{ path: \["whiteLabel", "customDomain"\], equals: host \} \}/);
  assert.match(source, /if \(organization && !available\(organization\)\) organization = null/);
  assert.match(source, /tenantSlugFromHost\(host\)/);
  assert.match(source, /BRANDING_NOT_FOUND/);
  assert.doesNotMatch(source, /res\.json\(\{ data: organization \}\)/);
});

test("white-label public route is mounted before authenticated feature routers", async () => {
  const server = await readFile(new URL("../server.ts", import.meta.url), "utf8");
  const publicMount = server.indexOf('app.use("/api/v1/public", publicBranding);');
  const protectedMount = server.indexOf('app.use("/api/v1/admin", onlyPaths(["/fees"], adminFees));');
  assert.ok(publicMount > -1);
  assert.ok(protectedMount > publicMount);
});

test("organization settings validate custom-domain ownership without a schema migration", async () => {
  const [organizations, domains] = await Promise.all([
    readFile(new URL("./organizations.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/tenant-domain.ts", import.meta.url), "utf8"),
  ]);
  assert.match(organizations, /CUSTOM_DOMAIN_EXISTS/);
  assert.match(organizations, /requireUniqueCustomDomain\(organizationId,d\.settings\)/);
  assert.match(organizations, /customDomainFromSettings\(settings,true\)/);
  assert.match(domains, /INVALID_CUSTOM_DOMAIN/);
  assert.match(domains, /CUSTOM_DOMAIN_RESERVED/);
  assert.match(domains, /platformWebHost/);
  assert.match(domains, /tenantSlugFromHost/);
});

test("tenant-facing web shell consumes runtime branding rather than a fixed admin brand", async () => {
  const provider = await readFile(new URL("../../../web/components/tenant-branding.tsx", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../../../web/components/sidebar.tsx", import.meta.url), "utf8");
  const portals = await readFile(new URL("../../../web/components/portal-auth.tsx", import.meta.url), "utf8");
  assert.match(provider, /public\/branding/);
  assert.match(provider, /organizationId: user\.organizationId/);
  assert.match(provider, /--brand-700/);
  assert.match(sidebar, /brand\.appName/);
  assert.match(sidebar, /brand\.portalName/);
  assert.match(provider, /hostBound/);
  assert.match(portals, /resolveWorkspace/);
  assert.match(portals, /readOnly=\{hostBound\}/);
  assert.match(portals, /brand\.loginHeadline/);
});


test("tenant-specific hosts cannot be used to select another workspace", async () => {
  const auth = await readFile(new URL("./auth.ts", import.meta.url), "utf8");
  assert.match(auth, /assertRequestHostMatchesOrganization/);
  assert.match(auth, /WORKSPACE_HOST_MISMATCH/);
  assert.match(auth, /tenantSlugFromHost\(host\)/);
  assert.match(auth, /customDomainFromSettings\(org\.settings\)/);
  assert.match(auth, /await assertRequestHostMatchesOrganization\(req, org\)/);
});


test("tenant custom URLs are accepted by CORS and authentication binds to browser origin", async () => {
  const [server, corsPolicy, auth] = await Promise.all([
    readFile(new URL("../server.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/cors-origin.ts", import.meta.url), "utf8"),
    readFile(new URL("./auth.ts", import.meta.url), "utf8"),
  ]);
  assert.match(server, /isTenantCorsOriginAllowed\(origin\)/);
  assert.match(corsPolicy, /tenantSlugFromHost\(host\)/);
  assert.match(corsPolicy, /\["whiteLabel", "customDomain"\]/);
  assert.match(corsPolicy, /isActive: true/);
  assert.match(auth, /req\.get\("origin"\) \?\? req\.get\("host"\)/);
  assert.match(auth, /WORKSPACE_HOST_MISMATCH/);
});
