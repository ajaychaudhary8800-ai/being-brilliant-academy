import assert from "node:assert/strict";
import test from "node:test";
import { activeAdminOptionUrls, resolveApiUrl } from "./admin-option-queries";

test("communication active option requests use the backend status contracts", () => {
  const urls = activeAdminOptionUrls("https://example.test/api/v1");
  assert.match(urls.batches, /[?&]status=ACTIVE$/);
  assert.doesNotMatch(urls.batches, /status=(?:active|inactive|archived)/);
  assert.match(urls.branches, /[?&]status=active$/);
});

test("notice active option requests use the same uppercase BatchStatus contract", () => {
  const urls = activeAdminOptionUrls("https://example.test/api/v1");
  assert.equal(new URL(urls.batches).searchParams.get("status"), "ACTIVE");
  assert.notEqual(new URL(urls.batches).searchParams.get("status"), "active");
});

test("communication request resolution does not duplicate a relative API base", () => {
  assert.equal(resolveApiUrl("/api/v1", "/api/v1/admin/branches?limit=100&status=active"), "/api/v1/admin/branches?limit=100&status=active");
  assert.equal(resolveApiUrl("/api/v1", "/communication/dashboard"), "/api/v1/communication/dashboard");
});
