import assert from "node:assert/strict";
import test from "node:test";
import { isManagedOrganizationLogo, saveOrganizationLogoWorkflow } from "./organization-logo-workflow";

const file = {} as File;
const base = { logoUrl: null };
const managed = (organizationId: string) => `/api/v1/uploaded-images/organization-logo/${organizationId}/123e4567-e89b-42d3-a456-426614174000.png`;

test("leaves creation failure untouched and performs no logo cleanup", async () => {
  let discarded = 0;
  await assert.rejects(() => saveOrganizationLogoWorkflow({ logoFile: file, patchPayload: base }, {
    create: async () => { throw new Error("organization failed"); },
    patch: async () => undefined,
    upload: async () => "/unused.png",
    discard: async () => { discarded += 1; },
    isManagedLogo: () => true,
  }), /organization failed/);
  assert.equal(discarded, 0);
});

test("creates an organization without a logo without an extra patch", async () => {
  let creates = 0;
  const patches: string[] = [];
  const result = await saveOrganizationLogoWorkflow({ logoFile: null, patchPayload: base }, {
    create: async () => { creates += 1; return { id: "org-new" }; },
    patch: async id => { patches.push(id); },
    upload: async () => "unused",
    discard: async () => undefined,
    isManagedLogo: () => true,
  });
  assert.deepEqual(result, { status: "saved", organizationId: "org-new", logoUrl: null });
  assert.equal(creates, 1);
  assert.deepEqual(patches, []);
});

test("creates and associates a logo with the created organization", async () => {
  const events: string[] = [];
  const result = await saveOrganizationLogoWorkflow({ logoFile: file, patchPayload: base }, {
    create: async () => { events.push("create"); return { id: "org-new" }; },
    patch: async (id, payload) => { events.push(`patch:${id}:${String(payload.logoUrl)}`); },
    upload: async (_file, id) => { events.push(`upload:${id}`); return "/new-logo.png"; },
    discard: async () => { events.push("discard"); },
    isManagedLogo: () => true,
  });
  assert.equal(result.status, "saved");
  assert.deepEqual(events, ["create", "upload:org-new", "patch:org-new:/new-logo.png"]);
});

test("preserves the created organization and retries as an edit after logo failure", async () => {
  let creates = 0;
  let uploads = 0;
  const first = await saveOrganizationLogoWorkflow({ logoFile: file, patchPayload: base }, {
    create: async () => { creates += 1; return { id: "org-recovered" }; },
    patch: async () => undefined,
    upload: async () => { uploads += 1; throw new Error("upload failed"); },
    discard: async () => undefined,
    isManagedLogo: () => true,
  });
  assert.equal(first.status, "created-logo-failed");
  if (first.status !== "created-logo-failed") throw new Error("expected partial create result");
  const second = await saveOrganizationLogoWorkflow({ organizationId: first.organizationId, logoFile: file, patchPayload: base }, {
    create: async () => { creates += 1; return { id: "wrong-retry" }; },
    patch: async () => undefined,
    upload: async () => { uploads += 1; return "/retry-logo.png"; },
    discard: async () => undefined,
    isManagedLogo: () => true,
  });
  assert.equal(second.status, "saved");
  assert.equal(creates, 1);
  assert.equal(uploads, 2);
});

test("patches a replacement before cleaning the previous managed logo", async () => {
  const events: string[] = [];
  const previous = managed("org-edit");
  await saveOrganizationLogoWorkflow({ organizationId: "org-edit", previousLogoUrl: previous, logoFile: file, patchPayload: base }, {
    patch: async (id, payload) => { events.push(`patch:${id}:${String(payload.logoUrl)}`); },
    upload: async (_file, id) => { events.push(`upload:${id}`); return "/new-logo.png"; },
    discard: async (url, id) => { events.push(`discard:${id}:${url}`); },
    isManagedLogo: isManagedOrganizationLogo,
  });
  assert.deepEqual(events, ["upload:org-edit", "patch:org-edit:/new-logo.png", `discard:org-edit:${previous}`]);
});

test("failed replacement patch discards only the new upload", async () => {
  const discarded: string[] = [];
  const previous = managed("org-edit");
  await assert.rejects(() => saveOrganizationLogoWorkflow({ organizationId: "org-edit", previousLogoUrl: previous, logoFile: file, patchPayload: base }, {
    patch: async () => { throw new Error("patch failed"); },
    upload: async () => "/new-logo.png",
    discard: async url => { discarded.push(url); },
    isManagedLogo: isManagedOrganizationLogo,
  }), /patch failed/);
  assert.deepEqual(discarded, ["/new-logo.png"]);
});

test("patches logo removal before cleaning the previous logo and keeps tenant IDs", async () => {
  const events: string[] = [];
  const previous = managed("org-remove");
  await saveOrganizationLogoWorkflow({ organizationId: "org-remove", previousLogoUrl: previous, logoFile: null, patchPayload: { logoUrl: null } }, {
    patch: async (id, payload) => { events.push(`patch:${id}:${String(payload.logoUrl)}`); },
    upload: async () => "unused",
    discard: async (url, id) => { events.push(`discard:${id}:${url}`); },
    isManagedLogo: isManagedOrganizationLogo,
  });
  assert.deepEqual(events, [`patch:org-remove:null`, `discard:org-remove:${previous}`]);
  assert.equal(isManagedOrganizationLogo(previous, "org-remove"), true);
  assert.equal(isManagedOrganizationLogo(previous, "org-other"), false);
  assert.equal(isManagedOrganizationLogo("https://legacy.example/logo.png", "org-remove"), false);
});
