import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const evidenceUrl = new URL("../../../../docs/FORMAL_COMMERCIAL_RELEASE_EVIDENCE.md", import.meta.url);
const manifestUrl = new URL("../../../../config/launch-readiness.json", import.meta.url);

test("Step 12 formal release evidence preserves protected GO and deployment controls", async () => {
  const evidence = await readFile(evidenceUrl, "utf8");

  assert.match(evidence, /Step 11 first real paying client evidence is COMPLETE/);
  assert.match(evidence, /pnpm launch:require-go/);
  assert.match(evidence, /Protected CI is green on the exact release commit/);
  assert.match(evidence, /Management has authorized the formal release/);
  assert.match(evidence, /Do not mark deployment successful merely because it was queued or started/);
  assert.match(evidence, /api\/health\/ready/);
  assert.match(evidence, /api\/health\/operational/);
  assert.match(evidence, /rollback reference/i);
});

test("formal release remains downstream while its evidence process is prepared", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8")) as {
    gates: Array<{ id: string; blocking: boolean; status: string; evidence: string[]; note?: string }>;
  };

  const gate = manifest.gates.find(item => item.id === "formal-release");
  assert.ok(gate);
  assert.equal(gate.blocking, false);
  assert.equal(gate.status, "PENDING_DEPENDENCY");
  assert.ok(gate.evidence.includes("docs/FORMAL_COMMERCIAL_RELEASE_EVIDENCE.md"));
  assert.match(gate.note ?? "", /internal Step 12 evidence controls are prepared/i);
});
