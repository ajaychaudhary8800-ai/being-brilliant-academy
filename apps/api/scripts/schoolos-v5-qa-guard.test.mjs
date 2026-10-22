import assert from "node:assert/strict";
import test from "node:test";
import { assertV5StagingBootstrapTarget, validateV5QaPassword, V5_QA_EMAIL } from "./schoolos-v5-qa-guard.mjs";

const valid = {
  SCHOOLOS_V5_QA_BOOTSTRAP_APPROVED: "ISOLATED_STAGING_ONLY",
  WEB_URL: "https://v5-staging.beingbrilliantedu.com",
  DATABASE_URL: "postgresql://schoolos_v5_user:synthetic@postgres:5432/schoolos_v5_staging?schema=public",
};

test("bootstrap accepts only exact isolated V5 staging target and explicit approval", () => {
  assert.deepEqual(assertV5StagingBootstrapTarget(valid), {
    database: "schoolos_v5_staging", email: V5_QA_EMAIL,
  });
  assert.throws(() => assertV5StagingBootstrapTarget({ ...valid, SCHOOLOS_V5_QA_BOOTSTRAP_APPROVED: "" }));
  assert.throws(() => assertV5StagingBootstrapTarget({ ...valid, WEB_URL: "https://beingbrilliantedu.com" }));
  assert.throws(() => assertV5StagingBootstrapTarget({ ...valid, WEB_URL: "https://main-staging.beingbrilliantedu.com" }));
  assert.throws(() => assertV5StagingBootstrapTarget({ ...valid, WEB_URL: "http://v5-staging.beingbrilliantedu.com" }));
});

test("bootstrap refuses database host, database name, user and port mismatch", () => {
  const cases = [
    "postgresql://schoolos_v5_user:synthetic@db:5432/schoolos_v5_staging",
    "postgresql://schoolos_v5_user:synthetic@postgres:5432/bba",
    "postgresql://bba:synthetic@postgres:5432/schoolos_v5_staging",
    "postgresql://schoolos_v5_user:synthetic@postgres:5433/schoolos_v5_staging",
    "postgresql://schoolos_v5_user:synthetic@localhost:5432/schoolos_v5_staging",
    "not-a-url",
  ];
  for (const url of cases) assert.throws(() => assertV5StagingBootstrapTarget({ ...valid, DATABASE_URL: url }));
});

test("synthetic staging QA account has strong password requirements", () => {
  assert.doesNotThrow(() => validateV5QaPassword("LongSyntheticQaPass2026!"));
  for (const bad of ["short", "somereallylongbutwithoutdigit!", "ALLUPPERCASE2026!", "lowercaseonly2026!", "MissingPunctuation2026"]) {
    assert.throws(() => validateV5QaPassword(bad));
  }
});
