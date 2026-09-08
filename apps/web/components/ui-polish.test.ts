import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("navigation keeps existing route paths and groups finance access", () => {
  const sidebar = read("apps/web/components/sidebar.tsx");
  assert.match(sidebar, /Fees & Finance/);
  assert.match(sidebar, /\/admin\/finance/);
  assert.match(sidebar, /accountantRoutes/);
  assert.match(sidebar, /role === "SUPER_ADMIN"/);
});

test("leave presentation uses meaningful metadata without rendering technical identifiers", () => {
  const parent = read("apps/web/components/parent-leave.ts");
  const portal = read("apps/web/components/portal-workspace.tsx");
  const admin = read("apps/web/app/admin/leaves/page.tsx");
  assert.match(parent, /parentLeaveAcademicLabel/);
  assert.match(portal, /Admission No:/);
  assert.match(admin, /Batch\/Class:/);
  assert.doesNotMatch(portal, /studentProfile\.id/);
  assert.doesNotMatch(admin, /studentProfile\.id/);
});

test("enquiry form preserves institution-local datetime input and responsive sections", () => {
  const page = read("apps/web/app/admin/enquiries/page.tsx");
  assert.match(page, /institutionDateTimeInput/);
  assert.match(page, /Student \/ Prospect/);
  assert.match(page, /Follow-up/);
  assert.match(page, /sm:grid-cols-2/);
  assert.match(page, /overflow-x-auto/);
});

test("explicit enum presentation is used by examination UI", () => {
  const page = read("apps/web/app/admin/examinations/page.tsx");
  assert.match(page, /displayLabel/);
  assert.match(page, /apiType/);
});

test("organization creation preserves subscriptions, platform authorization, and tenant-scoped logo settings", () => {
  const organizationsPage = read("apps/web/app/admin/organizations/page.tsx");
  const organizationsRoute = read("apps/api/src/routes/organizations.ts");
  const settingsPage = read("apps/web/app/admin/organization-settings/page.tsx");
  const uploadsRoute = read("apps/api/src/routes/image-uploads.ts");

  assert.match(organizationsPage, /Subscription status/);
  assert.match(organizationsPage, /Subscription plan/);
  assert.doesNotMatch(organizationsPage, /logoUrl|ImageUploadField/);
  assert.match(organizationsRoute, /r\.post\("\/platform\/organizations",async\(q:AuthRequest,s\)=>\{platform\(q\)/);
  assert.match(settingsPage, /ImageUploadField label="Institution Logo"/);
  assert.match(settingsPage, /\/admin\/image-uploads/);
  assert.match(uploadsRoute, /createStoredImageLocation\(input\.kind, req\.auth!\.organizationId, input\.mimeType\)/);
});
