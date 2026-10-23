#!/usr/bin/env node
/**
 * Non-invasive V5 staging transport diagnostics, executed only after
 * external GET smoke fails. Resolves public DNS and completes TLS handshakes,
 * never authenticates or sends an HTTP request/credential.
 *
 * Informational evidence only. NEVER turns a failed smoke job green.
 */
import dns from "node:dns/promises";
import tls from "node:tls";

export const DIAGNOSTIC_HOST = "v5-staging.beingbrilliantedu.com";

export function sanitizedErrorCode(error) {
  const candidate = error?.cause?.code ?? error?.code ?? "";
  return typeof candidate === "string" && /^[A-Z][A-Z0-9_]{1,40}$/.test(candidate)
    ? candidate : "UNCLASSIFIED";
}

export function summarizeDns(records) {
  return {
    ipv4: records.filter(entry => entry.family === 4).length,
    ipv6: records.filter(entry => entry.family === 6).length,
  };
}

async function tlsHandshake(family) {
  const started = Date.now();
  return new Promise(resolve => {
    let finished = false;
    const socket = tls.connect({
      host: DIAGNOSTIC_HOST, port: 443, servername: DIAGNOSTIC_HOST,
      family, rejectUnauthorized: true,
    });
    const finish = (status, errorCode) => {
      if (finished) return;
      finished = true;
      const result = {
        family: family === 4 ? "ipv4" : "ipv6", status,
        elapsed_ms: Date.now() - started,
        ...(errorCode ? { code: errorCode } : {}),
      };
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(7_000, () => finish("FAIL", "TLS_CONNECT_TIMEOUT"));
    socket.once("secureConnect", () => {
      finish(socket.authorized ? "PASS" : "FAIL",
        socket.authorized ? undefined : "TLS_CERTIFICATE_UNVERIFIED");
    });
    socket.once("error", error => finish("FAIL", sanitizedErrorCode(error)));
  });
}

export async function diagnoseStagingTransport() {
  const start = new Date().toISOString();
  let dnsSummary;
  try {
    dnsSummary = { status: "PASS", ...summarizeDns(await dns.lookup(DIAGNOSTIC_HOST, { all: true })) };
  } catch (error) {
    dnsSummary = { status: "FAIL", code: sanitizedErrorCode(error), ipv4: 0, ipv6: 0 };
  }
  const tlsResults = [];
  for (const [family, count] of [[4, dnsSummary.ipv4], [6, dnsSummary.ipv6]]) {
    tlsResults.push(count ? await tlsHandshake(family) : {
      family: family === 4 ? "ipv4" : "ipv6",
      status: "SKIPPED", code: "DNS_FAMILY_UNAVAILABLE",
    });
  }
  return {
    host: DIAGNOSTIC_HOST, at: start,
    dns: dnsSummary, tls: tlsResults,
    changesMade: false, credentialsUsed: false,
    productionReleaseApproved: false,
  };
}

if (process.argv[1]?.endsWith("schoolos-v5-network-diagnostics.mjs")) {
  diagnoseStagingTransport()
    .then(result => console.log("V5_STAGING_NETWORK_DIAGNOSTICS " + JSON.stringify(result)))
    .catch(error => {
      console.log("V5_STAGING_NETWORK_DIAGNOSTICS_FAILED code=" + sanitizedErrorCode(error));
    });
}
