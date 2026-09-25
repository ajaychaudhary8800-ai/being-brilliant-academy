import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeUrl = new URL("./platform-control-center.ts", import.meta.url);
const serverUrl = new URL("../server.ts", import.meta.url);
const dockerUrl = new URL("../../Dockerfile", import.meta.url);
const roadmapUrl = new URL("../../../../config/project-roadmap.json", import.meta.url);
const launchUrl = new URL("../../../../config/launch-readiness.json", import.meta.url);
const pageUrl = new URL("../../../web/app/admin/control-center/page.tsx", import.meta.url);
const sidebarUrl = new URL("../../../web/components/sidebar.tsx", import.meta.url);
const hrUrl = new URL("../../../web/app/admin/hr/page.tsx", import.meta.url);

test("roadmap source covers all 14 numbered steps exactly once", async () => {
  const roadmap = JSON.parse(await readFile(roadmapUrl, "utf8"));
  assert.equal(roadmap.steps.length, 14);
  assert.deepEqual(roadmap.steps.map((step: any) => step.step), Array.from({ length: 14 }, (_, index) => index + 1));
  for (const step of roadmap.steps) {
    assert.ok(step.name);
    assert.ok(step.status);
    assert.ok(Array.isArray(step.webRoutes) && step.webRoutes.length > 0);
  }
});

test("current roadmap truth preserves unresolved real-world dependencies", async () => {
  const roadmap = JSON.parse(await readFile(roadmapUrl, "utf8"));
  const byStep = new Map(roadmap.steps.map((step: any) => [step.step, step]));
  assert.equal((byStep.get(5) as any)?.status, "PENDING_EXTERNAL");
  assert.equal((byStep.get(11) as any)?.status, "PENDING_CLIENT");
  assert.equal((byStep.get(12) as any)?.status, "BLOCKED_DEPENDENCY");
  assert.match((byStep.get(12) as any)?.dependency ?? "", /Step 11/);
  assert.equal((byStep.get(13) as any)?.status, "COMPLETE");
  assert.equal((byStep.get(14) as any)?.status, "COMPLETE");
});

test("control center API is platform-only and reads controlled roadmap and launch data", async () => {
  const route = await readFile(routeUrl, "utf8");
  assert.match(route, /requireAuth/);
  assert.match(route, /homeOrganizationId !== "org_default"/);
  assert.match(route, /PLATFORM_ADMIN_REQUIRED/);
  assert.match(route, /project-roadmap\.json/);
  assert.match(route, /launch-readiness\.json/);
  assert.match(route, /\/platform\/control-center/);
});

test("server and runtime image package the control center source of truth", async () => {
  const [server, docker] = await Promise.all([
    readFile(serverUrl, "utf8"),
    readFile(dockerUrl, "utf8"),
  ]);
  assert.match(server, /platform-control-center\.js/);
  assert.match(server, /onlyPaths\(\["\/platform\/control-center"\], platformControlCenter\)/);
  assert.match(docker, /COPY --chown=app:app config \.\/config/);
});

test("Platform Admin UI exposes the 14-step roadmap, live health and launch blockers", async () => {
  const [page, sidebar] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(sidebarUrl, "utf8"),
  ]);
  assert.match(sidebar, /SaaS Control Center.*\/admin\/control-center.*platformOnly: true/);
  assert.match(page, /1–14 roadmap/);
  assert.match(page, /Live platform health/);
  assert.match(page, /Launch blockers/);
  assert.match(page, /\/health\/ready/);
  assert.match(page, /\/health\/operational/);
  assert.match(page, /\/health\/integrations/);
  for (const expected of [
    "/admin/organizations",
    "/admin/saas-plans",
    "/admin/saas-billing",
    "/admin/saas-sales",
    "/admin/legal-sales",
    "/admin/implementation-kit",
  ]) assert.ok(page.includes(expected), "missing web control " + expected);
});

test("launch source remains HOLD while hard blockers are unresolved", async () => {
  const launch = JSON.parse(await readFile(launchUrl, "utf8"));
  assert.equal(launch.declaredStatus, "HOLD");
});

test("internal HR tenant identifiers remain hidden from user-facing tables", async () => {
  const hr = await readFile(hrUrl, "utf8");
  assert.match(hr, /INTERNAL_KEYS/);
  assert.match(hr, /"organizationId"/);
  assert.doesNotMatch(hr, /<th[^>]*>\s*Organization ID\s*<\/th>/i);
});
