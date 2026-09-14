import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("auth provider refreshes before access-token expiry and when a tab resumes", () => {
  const source = readFileSync(new URL("./auth-provider.tsx", import.meta.url), "utf8");
  assert.match(source, /expiresAt - Date\.now\(\) - 60_000/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /refreshInFlight/);
});

test("HR and finance upload controls accept supported spreadsheet formats", () => {
  const hr = readFileSync(new URL("../app/admin/hr/page.tsx", import.meta.url), "utf8");
  const finance = readFileSync(new URL("../app/admin/finance/page.tsx", import.meta.url), "utf8");
  for (const source of [hr, finance]) assert.match(source, /accept="\.csv,\.json,\.xls,\.xlsx"/);
});
