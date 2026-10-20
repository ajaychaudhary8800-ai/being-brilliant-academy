#!/usr/bin/env node
/**
 * Trusted OPERATOR-ONLY authenticated staging read-only QA.
 *
 * Do not execute in GitHub pull_request runners.
 * The dedicated isolated staging QA password is piped on STDIN from a
 * non-echo terminal prompt and is never printed or written to artifacts.
 */
import { runReadOnlyStagingQa, STAGING_ORIGIN } from "./schoolos-v5-external-staging-smoke.mjs";

const QA_EMAIL = "schoolos-v5-qa-platform@example.test";

async function main() {
  if (process.env.SCHOOLOS_V5_QA_TRUSTED_RUN !== "OWNER_APPROVED_LOCAL_ONLY") {
    throw new Error("This authenticated QA requires owner-approved local execution");
  }
  if (process.env.CI || process.env.GITHUB_ACTIONS) {
    throw new Error("Authenticated QA is prohibited inside GitHub Actions");
  }
  if (process.argv.slice(2).length) throw new Error("No CLI arguments permitted");
  if (process.stdin.isTTY) {
    throw new Error("Read the password from a private no-echo prompt piped to STDIN");
  }
  let password = "";
  for await (const chunk of process.stdin) {
    password += chunk.toString("utf8");
    if (password.length > 128) throw new Error("Invalid QA password length");
  }
  if (password.length < 20) throw new Error("Invalid QA password length");
  const env = {
    SCHOOLOS_QA_EMAIL: QA_EMAIL,
    SCHOOLOS_QA_PASSWORD: password,
    SCHOOLOS_QA_WORKSPACE: "being-brilliant-academy",
  };
  try {
    const result = await runReadOnlyStagingQa({ baseUrl: STAGING_ORIGIN, env });
    if (result.result !== "PASS") process.exitCode = 1;
    console.log("TRUSTED_STAGING_QA=" + result.result);
    console.log("LIVE_STAGING_UAT_APPROVAL=NOT_GRANTED");
    console.log("RESULTS=NOT_PERSISTED");
  } finally {
    password = "";
    env.SCHOOLOS_QA_PASSWORD = "";
  }
}

main().catch(error => {
  // Do not print dynamic network errors, passwords or raw API responses.
  console.error("TRUSTED_STAGING_QA=FAIL");
  if (/^This authenticated |^Authenticated QA is prohibited |^No CLI |^Read the password |^Invalid QA password/.test(error.message ?? "")) {
    console.error(error.message);
  }
  process.exitCode = 1;
});
