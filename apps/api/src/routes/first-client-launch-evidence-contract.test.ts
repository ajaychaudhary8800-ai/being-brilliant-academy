import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const evidenceUrl = new URL("../../../../docs/FIRST_CLIENT_GO_LIVE_EVIDENCE.md", import.meta.url);
const manifestUrl = new URL("../../../../config/launch-readiness.json", import.meta.url);

test("Step 11 first-paying-client evidence requires a real commercial go-live", async () => {
  const evidence = await readFile(evidenceUrl, "utf8");

  assert.match(evidence, /real external paying institution/i);
  assert.match(evidence, /SaaS Sales lead must be marked \*\*WON\*\*/);
  assert.match(evidence, /Signed\/accepted Order Form reference/);
  assert.match(evidence, /Payment provider\/reference/);
  assert.match(evidence, /onboarding panel must report \*\*READY \/ 100%\*\*/);
  assert.match(evidence, /Client UAT acceptance is recorded/);
  assert.match(evidence, /Final handover\/acceptance certificate completed/);
  assert.match(evidence, /Post-go-live smoke validation/);
  assert.match(evidence, /QA, demo, synthetic or internal tenants/i);
});

test("launch readiness keeps Step 11 pending until real-client evidence exists", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8")) as {
    gates: Array<{ id: string; status: string; evidence: string[]; note?: string }>;
  };

  const gate = manifest.gates.find(item => item.id === "first-paying-client");
  assert.ok(gate);
  assert.equal(gate.status, "PENDING_DEPENDENCY");
  assert.ok(gate.evidence.includes("docs/FIRST_CLIENT_GO_LIVE_EVIDENCE.md"));
  assert.match(gate.note ?? "", /real paying institution/i);
});
