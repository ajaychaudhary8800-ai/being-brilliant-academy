import assert from "node:assert/strict";
import test from "node:test";
import { safeStagingOrigin, credentialState, runReadOnlyStagingQa, STAGING_ORIGIN } from "./schoolos-v5-external-staging-smoke.mjs";

test("rejects production, localhost, staging lookalikes, ports and URL credentials", () => {
  assert.equal(safeStagingOrigin(STAGING_ORIGIN), STAGING_ORIGIN);
  for (const unsafe of [
    "https://beingbrilliantedu.com",
    "https://main-staging.beingbrilliantedu.com",
    "http://v5-staging.beingbrilliantedu.com",
    "https://v5-staging.beingbrilliantedu.com:8443",
    "https://v5-staging.beingbrilliantedu.com.attacker.invalid",
    "https://v5-staging.beingbrilliantedu.com/other",
    "https://person:secret@v5-staging.beingbrilliantedu.com",
  ]) assert.throws(() => safeStagingOrigin(unsafe));
});

test("prevents half-configured authentication secrets", () => {
  assert.deepEqual(credentialState({}), { configured: false, email: "", password: "" });
  assert.throws(() => credentialState({ SCHOOLOS_QA_EMAIL: "qa@example.test" }));
  assert.throws(() => credentialState({ SCHOOLOS_QA_PASSWORD: "not-in-logs" }));
});

function response(status, body = {}) {
  return { status, json: async () => body };
}

test("read-only public smoke labels missing secrets as partial, never full approval", async () => {
  const routes = [];
  const request = async (url, init) => {
    assert.equal(init, undefined, "No unauthenticated mutating requests");
    assert.ok(url.startsWith(STAGING_ORIGIN + "/"));
    routes.push(url);
    return response(url.includes("/api/v1/") ? 401 : 200);
  };
  const result = await runReadOnlyStagingQa({ env: {}, request });
  assert.equal(result.result, "PARTIAL_PASS_AUTH_REQUIRED");
  assert.equal(result.readOnly, true);
  assert.equal(result.coachingLiveUatApproved, false);
  assert.equal(result.commercialReleaseApproved, false);
  assert.equal(result.checks.filter(x => x.status === "PASS").length, 6);
  assert.equal(result.checks.filter(x => x.status === "SKIPPED").length, 2);
  assert.equal(routes.length, 6);
});

test("authenticated QA inventory uses staging-only API and validates both synthetic tenants", async () => {
  const requests = [];
  const result = await runReadOnlyStagingQa({
    env: { SCHOOLOS_QA_EMAIL: "qa@example.test", SCHOOLOS_QA_PASSWORD: "synthetic-only" },
    request: async (url, init) => {
      requests.push({ url, method: init?.method ?? "GET" });
      if (url.endsWith("/api/v1/auth/login")) {
        assert.equal(init.method, "POST");
        assert.equal(JSON.parse(init.body).password, "synthetic-only");
        return response(200, { data: { accessToken: "synthetic-token", user: { role: "SUPER_ADMIN" } } });
      }
      if (url.includes("/api/v1/platform/organizations?page=")) {
        assert.equal(init.headers.Authorization, "Bearer synthetic-token");
        return response(200, { data: [
          { slug: "schoolos-qa-coaching" },
          { slug: "schoolos-qa-school" },
        ] });
      }
      return response(url.includes("/api/v1/") ? 401 : 200);
    },
  });
  assert.equal(result.result, "PASS");
  assert.equal(result.credentialsAvailable, true);
  assert.equal(result.commercialReleaseApproved, false);
  assert.equal(requests.filter(r => r.method !== "GET").length, 1);
  assert.equal(requests.filter(r => r.method === "POST")[0].url, STAGING_ORIGIN + "/api/v1/auth/login");
});

test("authenticated inventory fails closed if either QA tenant is missing", async () => {
  const originalLog = console.log;
  console.log = () => {};
  try {
    const result = await runReadOnlyStagingQa({
      env: { SCHOOLOS_QA_EMAIL: "qa@example.test", SCHOOLOS_QA_PASSWORD: "test-pass" },
      request: async (url) => {
        if (url.endsWith("/api/v1/auth/login")) return response(200, {
          data: { accessToken: "fake", user: { role: "SUPER_ADMIN" } },
        });
        if (url.includes("/api/v1/platform/organizations?page=")) return response(200, {
          data: [{ slug: "schoolos-qa-coaching" }],
        });
        return response(url.includes("/api/v1/") ? 401 : 200);
      },
    });
    assert.equal(result.result, "FAIL");
    assert.ok(result.checks.some(x => x.id === "V5_QA_TENANT_INVENTORY" && x.status === "FAIL"));
  } finally { console.log = originalLog; }
});
