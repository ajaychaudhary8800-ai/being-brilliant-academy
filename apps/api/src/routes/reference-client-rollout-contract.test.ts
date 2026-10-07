import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bbaUrl = new URL("../../../../docs/BBA_REFERENCE_TENANT_GO_LIVE.md", import.meta.url);
const greenShineUrl = new URL("../../../../docs/GREEN_SHINE_FIRST_CLIENT_GO_LIVE.md", import.meta.url);
const manifestUrl = new URL("../../../../config/launch-readiness.json", import.meta.url);

test("reference rollout keeps internal BBA distinct from the external first-client gate", async () => {
  const [bba, greenShine] = await Promise.all([
    readFile(bbaUrl, "utf8"),
    readFile(greenShineUrl, "utf8"),
  ]);

  assert.match(bba, /Being Brilliant Academy/);
  assert.match(bba, /does \*\*not\*\* satisfy the Step 11 first real external paying client gate/i);
  assert.match(bba, /onboarding reports READY \/ 100%/i);

  assert.match(greenShine, /Green Shine World School/);
  assert.match(greenShine, /Designated first external school client candidate for Step 11/i);
  assert.match(greenShine, /SaaS Sales lead \*\*WON\*\*/i);
  assert.match(greenShine, /Test-mode Razorpay transactions, QA payments, synthetic invoices/i);
  assert.match(greenShine, /onboarding reports \*\*READY \/ 100%\*\*/i);
  assert.match(greenShine, /Production smoke validation passes/i);
});

test("launch manifest names Green Shine as the candidate but remains pending until evidence is real", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8")) as {
    gates: Array<{ id: string; status: string; evidence: string[]; nextAction?: string; note?: string }>;
  };

  const gate = manifest.gates.find(item => item.id === "first-paying-client");
  assert.ok(gate);
  assert.equal(gate.status, "PENDING_DEPENDENCY");
  assert.ok(gate.evidence.includes("docs/GREEN_SHINE_FIRST_CLIENT_GO_LIVE.md"));
  assert.match(gate.nextAction ?? "", /Green Shine World School/);
  assert.match(gate.note ?? "", /Being Brilliant Academy/i);
  assert.match(gate.note ?? "", /does not satisfy/i);
});
