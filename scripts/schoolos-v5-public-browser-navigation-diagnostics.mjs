/**
 * SchoolOS V5 external public browser QA: bounded, credential-free failure labels.
 * Intentionally never emits raw browser error text, hostnames, paths, headers,
 * cookies, response bodies, arbitrary HTML or student/customer information.
 * A browser timeout remains a failure, even when the independent HTTP probe is 200.
 */

const ROUTES = new Set([
  "/login", "/login/admin", "/login/teacher", "/login/student",
  "/login/parent", "/login/employee",
]);

export function assertPublicLoginRoute(pathname) {
  if (typeof pathname !== "string" || !ROUTES.has(pathname)) {
    throw new Error("PUBLIC_BROWSER_QA_ROUTE_BLOCKED");
  }
  return pathname;
}

export function browserTransportClass(error) {
  const raw = typeof error === "string" ? error : "";
  if (/ERR_NAME_NOT_RESOLVED|ERR_DNS_TIMED_OUT/i.test(raw)) return "DNS";
  if (/ERR_CERT_|ERR_SSL_|ERR_TLS_/i.test(raw)) return "TLS";
  if (/ERR_CONNECTION_|ERR_ADDRESS_UNREACHABLE|ERR_NETWORK_CHANGED/i.test(raw)) return "CONNECT";
  if (/ERR_TIMED_OUT|TimeoutError|timeout/i.test(raw)) return "TIMEOUT";
  if (/ERR_TOO_MANY_REDIRECTS/i.test(raw)) return "REDIRECT";
  return "OTHER";
}

export function safeBrowserNavigationVerdict({ domReady, mainStatus, requestFailure, probeStatus }) {
  const http = Number.isInteger(mainStatus) && mainStatus >= 100 && mainStatus <= 599
    ? mainStatus : null;
  const independent = Number.isInteger(probeStatus) && probeStatus >= 100 && probeStatus <= 599
    ? probeStatus : null;
  const permittedFailure = new Set(["NONE", "DNS", "TLS", "CONNECT", "TIMEOUT", "REDIRECT", "OTHER"]);
  const failure = permittedFailure.has(requestFailure) ? requestFailure : "OTHER";
  let category;
  if (domReady === true) category = "DOM_READY_NAVIGATION_FAILED";
  else if (http !== null) category = "DOCUMENT_RESPONSE_NO_DOM_READY";
  else if (failure !== "NONE") category = "BROWSER_REQUEST_" + failure;
  else if (independent === 200) category = "HTTP_200_BROWSER_NAVIGATION_UNRESOLVED";
  else if (independent !== null) category = "HTTP_PROBE_NON_200_NO_BROWSER_RESPONSE";
  else category = "NO_BROWSER_OR_HTTP_RESPONSE";
  return Object.freeze({
    category,
    mainStatus: http === null ? "NONE" : String(http),
    probeStatus: independent === null ? "NONE" : String(independent),
    domReady: domReady === true ? "YES" : "NO",
    requestFailure: failure,
    browserUiVerdict: "FAIL_NOT_CLEARED",
  });
}
