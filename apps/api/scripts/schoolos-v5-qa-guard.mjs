/**
 * Fail-closed target policy for one-time V5 *isolated staging* QA identity.
 * Never weaken this to host suffix matching, process names, or NODE_ENV alone.
 */
export const V5_QA_EMAIL = "schoolos-v5-qa-platform@example.test";

export function assertV5StagingBootstrapTarget(env) {
  if (env.SCHOOLOS_V5_QA_BOOTSTRAP_APPROVED !== "ISOLATED_STAGING_ONLY") {
    throw new Error("Explicit isolated staging QA bootstrap approval required");
  }
  if (env.WEB_URL !== "https://v5-staging.beingbrilliantedu.com") {
    throw new Error("Target is not the pinned V5 staging web URL");
  }
  let parsed;
  try { parsed = new URL(env.DATABASE_URL); }
  catch { throw new Error("Invalid database target"); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || parsed.hostname !== "postgres"
    || parsed.pathname !== "/schoolos_v5_staging"
    || parsed.username !== "schoolos_v5_user"
    || (parsed.port && parsed.port !== "5432")
    || parsed.hash) {
    throw new Error("Database does not match dedicated V5 staging PostgreSQL");
  }
  return { database: "schoolos_v5_staging", email: V5_QA_EMAIL };
}

export function validateV5QaPassword(password) {
  if (typeof password !== "string" || password.length < 20 || password.length > 128
      || !/[A-Z]/.test(password) || !/[a-z]/.test(password)
      || !/[0-9]/.test(password) || !/[^a-zA-Z0-9]/.test(password)) {
    throw new Error("QA password must be 20-128 chars with upper, lower, digit and punctuation");
  }
}
