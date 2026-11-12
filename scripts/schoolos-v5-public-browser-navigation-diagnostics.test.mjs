import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPublicLoginRoute, browserTransportClass, safeBrowserNavigationVerdict,
} from "./schoolos-v5-public-browser-navigation-diagnostics.mjs";

const APPROVED = [
  "/login", "/login/admin", "/login/teacher", "/login/student",
  "/login/parent", "/login/employee",
];

test("public QA routes are explicitly restricted; no credentials or other origins", () => {
  for (const route of APPROVED) assert.equal(assertPublicLoginRoute(route), route);
  for (const path of [
    "/", "/api/v1/admin/users", "/login/admin?token=sensitive",
    "https://other.invalid/login/admin", "//other.invalid/login",
    "/login/../api/v1/admin", "/login/admin#secret", "", null,
  ]) assert.throws(() => assertPublicLoginRoute(path), /PUBLIC_BROWSER_QA_ROUTE_BLOCKED/);
});

test("browser failure label strips arbitrary error bodies and sensitive URLs", () => {
  const labels = [
    ["net::ERR_NAME_NOT_RESOLVED https://hidden.invalid/?token=very-secret", "DNS"],
    ["net::ERR_CERT_AUTHORITY_INVALID", "TLS"],
    ["net::ERR_CONNECTION_RESET", "CONNECT"],
    ["TimeoutError: page.goto 20000ms https://hidden.invalid/password", "TIMEOUT"],
    ["net::ERR_TOO_MANY_REDIRECTS", "REDIRECT"],
    ["hidden access-token abc123", "OTHER"],
  ];
  for (const [error, expected] of labels) {
    const label = browserTransportClass(error);
    assert.equal(label, expected);
    assert.doesNotMatch(label, /hidden|token|password|invalid|abc123|https/i);
  }
});

test("HTTP 200 probe never clears a failed Chromium navigation", () => {
  const actual = safeBrowserNavigationVerdict({
    domReady: false, mainStatus: null, requestFailure: "NONE", probeStatus: 200,
  });
  assert.equal(actual.category, "HTTP_200_BROWSER_NAVIGATION_UNRESOLVED");
  assert.equal(actual.browserUiVerdict, "FAIL_NOT_CLEARED");
  assert.equal(actual.probeStatus, "200");
});

test("main document 200 without DOMContentLoaded is classified separately", () => {
  const a = safeBrowserNavigationVerdict({
    domReady: false, mainStatus: 200, requestFailure: "NONE", probeStatus: 200,
  });
  assert.equal(a.category, "DOCUMENT_RESPONSE_NO_DOM_READY");
  assert.equal(a.browserUiVerdict, "FAIL_NOT_CLEARED");
});

test("DNS failure is not misdiagnosed as SSR or DOM timeout", () => {
  const a = safeBrowserNavigationVerdict({
    domReady: false, mainStatus: null, requestFailure: "DNS", probeStatus: 200,
  });
  assert.equal(a.category, "BROWSER_REQUEST_DNS");
  assert.equal(a.browserUiVerdict, "FAIL_NOT_CLEARED");
});

test("unknown or poisoned status/failure data is sanitized to an enum", () => {
  const a = safeBrowserNavigationVerdict({
    domReady: false, mainStatus: 99999,
    requestFailure: "Bearer token-value-123", probeStatus: "password",
  });
  assert.equal(a.category, "BROWSER_REQUEST_OTHER");
  const out = JSON.stringify(a);
  assert.doesNotMatch(out, /Bearer|token-value|password/);
  assert.equal(a.mainStatus, "NONE");
  assert.equal(a.probeStatus, "NONE");
});

test("a DOM-ready navigation failure remains a failed UI result", () => {
  const a = safeBrowserNavigationVerdict({
    domReady: true, mainStatus: 200, requestFailure: "NONE", probeStatus: null,
  });
  assert.equal(a.category, "DOM_READY_NAVIGATION_FAILED");
  assert.equal(a.browserUiVerdict, "FAIL_NOT_CLEARED");
});
