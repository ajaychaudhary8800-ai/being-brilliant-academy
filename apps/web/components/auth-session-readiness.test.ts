import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("AuthProvider proactively refreshes expiring access tokens and serializes refresh rotation", () => {
  const source = readFileSync(new URL("./auth-provider.tsx", import.meta.url), "utf8");
  assert.match(source, /accessTokenExpiry/);
  assert.match(source, /refreshInFlight = useRef<Promise<AuthUser \| null> \| null>/);
  assert.match(source, /if \(refreshInFlight\.current\) return refreshInFlight\.current/);
  assert.match(source, /expiry <= Date\.now\(\) \+ 120_000/);
  assert.match(source, /setInterval\(renewIfNeeded, 60_000\)/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /document\.visibilityState === "visible"/);
});

test("public self-registration is not exposed by the client auth context", () => {
  const source = readFileSync(new URL("./auth-provider.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /register:\s*\(/);
  assert.doesNotMatch(source, /authenticate\("register"/);
});
