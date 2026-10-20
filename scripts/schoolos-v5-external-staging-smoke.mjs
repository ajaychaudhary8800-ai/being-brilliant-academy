#!/usr/bin/env node
/**
 * Read-only external SchoolOS V5 staging smoke QA.
 * Restricted to the exact isolated staging hostname. Never mutates tenant data.
 * Optional encrypted secrets: SCHOOLOS_QA_EMAIL and SCHOOLOS_QA_PASSWORD
 * (dedicated staging-only platform QA account, NOT a production owner login).
 * PASS here does not constitute coaching UAT or commercial signoff.
 */
import fs from "node:fs";

export const STAGING_ORIGIN = "https://v5-staging.beingbrilliantedu.com";

export function safeStagingOrigin(input = STAGING_ORIGIN) {
  const parsed = new URL(input);
  if (parsed.origin !== STAGING_ORIGIN || parsed.pathname !== "/" || parsed.search ||
      parsed.hash || parsed.username || parsed.password) {
    throw new Error("External QA restricted to exact V5 staging origin");
  }
  return STAGING_ORIGIN;
}

export function credentialState(env) {
  const email = env.SCHOOLOS_QA_EMAIL?.trim() ?? "";
  const password = env.SCHOOLOS_QA_PASSWORD ?? "";
  if (Boolean(email) !== Boolean(password)) {
    throw new Error("Configure both staging-only QA credentials, or neither");
  }
  return { configured: Boolean(email), email, password };
}

async function send(url, init = {}) {
  return fetch(url, {
    ...init, redirect: "manual", signal: AbortSignal.timeout(15_000),
    headers: { Accept: "application/json, text/html", ...(init.headers ?? {}) },
  });
}

export async function runReadOnlyStagingQa({ baseUrl = STAGING_ORIGIN, env = process.env, request = send } = {}) {
  const base = safeStagingOrigin(baseUrl);
  const credentials = credentialState(env);
  const startedAt = new Date().toISOString();
  const checks = [];
  const add = (id, status, detail) => {
    checks.push({ id, status, ...(detail ? { detail } : {}) });
    console.log(id + ": " + status + (detail ? " — " + detail : ""));
  };
  async function publicCheck(id, route) {
    try {
      const response = await request(base + route);
      if (response.status !== 200) throw new Error("HTTP " + response.status + ", expected 200");
      add(id, "PASS", "HTTP 200");
    } catch (error) { add(id, "FAIL", error instanceof Error ? error.message : "Request failed"); }
  }
  await publicCheck("V5_PUBLIC_HOME", "/");
  await publicCheck("V5_ADMIN_LOGIN_PAGE", "/login/admin");
  await publicCheck("V5_API_READY", "/api/health/ready");
  await publicCheck("V5_API_OPERATIONAL", "/api/health/operational");

  for (const [id, route] of [
    ["V5_NO_ANONYMOUS_PLATFORM_TENANTS", "/api/v1/platform/organizations"],
    ["V5_NO_ANONYMOUS_ADMIN_BATCHES", "/api/v1/admin/batches"],
  ]) {
    try {
      const response = await request(base + route);
      if (response.status !== 401 && response.status !== 403) {
        throw new Error("HTTP " + response.status + ": anonymous request not explicitly denied");
      }
      add(id, "PASS", "HTTP " + response.status);
    } catch (error) { add(id, "FAIL", error instanceof Error ? error.message : "Request failed"); }
  }

  if (!credentials.configured) {
    add("V5_AUTHENTICATED_ADMIN", "SKIPPED", "Dedicated staging QA credentials not configured");
    add("V5_QA_TENANT_INVENTORY", "SKIPPED", "Dedicated staging QA credentials not configured");
  } else {
    // Never log tokens, password, raw server responses or tenant PII.
    const workspace = env.SCHOOLOS_QA_WORKSPACE || "being-brilliant-academy";
    let authenticated = false;
    try {
      if (workspace !== "being-brilliant-academy") throw new Error("Platform QA requires default staging workspace");
      const response = await request(base + "/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: credentials.email, password: credentials.password,
          organization: workspace, portal: "admin", rememberMe: false,
        }),
      });
      if (response.status !== 200) throw new Error("QA login HTTP " + response.status);
      const payload = await response.json();
      const token = payload?.data?.accessToken;
      if (!token || payload?.data?.user?.role !== "SUPER_ADMIN") {
        throw new Error("No platform QA administrator session");
      }
      authenticated = true;
      add("V5_AUTHENTICATED_ADMIN", "PASS", "Authenticated staging API login");
      const inventory = await request(base + "/api/v1/platform/organizations?page=1&limit=50", {
        headers: { Authorization: "Bearer " + token },
      });
      if (inventory.status !== 200) throw new Error("QA inventory HTTP " + inventory.status);
      const listing = await inventory.json();
      const slugs = new Set((listing?.data ?? []).map(row => row.slug));
      const missing = ["schoolos-qa-coaching", "schoolos-qa-school"].filter(slug => !slugs.has(slug));
      if (missing.length) throw new Error("QA institutions missing: " + missing.join(", "));
      add("V5_QA_TENANT_INVENTORY", "PASS", "Two isolated QA institutions visible");
    } catch (error) {
      add(authenticated ? "V5_QA_TENANT_INVENTORY" : "V5_AUTHENTICATED_ADMIN",
        "FAIL", error instanceof Error ? error.message : "Request failed");
    }
  }

  return {
    product: "Adhyay SchoolOS", version: "5.0",
    environment: "ISOLATED_EXTERNAL_STAGING",
    baseUrl: base, startedAt, completedAt: new Date().toISOString(),
    readOnly: true, credentialsAvailable: credentials.configured, checks,
    result: checks.some(check => check.status === "FAIL") ? "FAIL"
      : checks.some(check => check.status === "SKIPPED") ? "PARTIAL_PASS_AUTH_REQUIRED" : "PASS",
    coachingLiveUatApproved: false, commercialReleaseApproved: false,
  };
}

if (process.argv[1]?.endsWith("schoolos-v5-external-staging-smoke.mjs")) {
  runReadOnlyStagingQa({ baseUrl: process.env.SCHOOLOS_QA_BASE_URL })
    .then(result => {
      fs.mkdirSync("artifacts/v5-external-smoke", { recursive: true });
      fs.writeFileSync("artifacts/v5-external-smoke/result.json", JSON.stringify(result, null, 2) + "\n");
      if (result.result === "FAIL") process.exitCode = 1;
    })
    .catch(error => {
      console.error("V5 staging QA configuration failed:", error instanceof Error ? error.message : "Unknown error");
      process.exitCode = 1;
    });
}
