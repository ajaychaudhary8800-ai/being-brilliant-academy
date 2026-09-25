import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const manifestUrl = new URL("../../../../config/launch-readiness.json", import.meta.url);
const scriptUrl = new URL("../../../../scripts/check-launch-readiness.mjs", import.meta.url);
const readinessDocUrl = new URL("../../../../docs/LAUNCH_READINESS.md", import.meta.url);
const launchDayUrl = new URL("../../../../docs/LAUNCH_DAY_RUNBOOK.md", import.meta.url);
const workflowUrl = new URL("../../../../.github/workflows/launch-readiness.yml", import.meta.url);
const ciUrl = new URL("../../../../.github/workflows/ci.yml", import.meta.url);
const packageUrl = new URL("../../../../package.json", import.meta.url);
const landingUrl = new URL("../../../web/components/premium-landing.tsx", import.meta.url);

test("Step 14 launch manifest is truthful about current blockers", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8")) as {
    declaredStatus: string;
    gates: Array<{ id: string; name: string; blocking: boolean; status: string; dependency?: string; nextAction?: string }>;
  };

  assert.equal(manifest.declaredStatus, "HOLD");

  const byId = new Map(manifest.gates.map(gate => [gate.id, gate]));
  for (const id of [
    "product-platform",
    "quality-stability",
    "client-onboarding",
    "commercial-packaging",
    "legal-contract-pack",
    "sales-acquisition",
    "monitoring-operations",
  ]) {
    assert.equal(byId.get(id)?.status, "READY", `${id} should be READY`);
  }

  assert.equal(byId.get("offsite-dr")?.status, "PENDING_DEPENDENCY");
  assert.equal(byId.get("offsite-dr")?.dependency, "Step 5");
  assert.equal(byId.get("legal-execution")?.status, "BLOCKED_EXTERNAL");
  assert.equal(byId.get("public-legal-pages")?.status, "PENDING_DEPENDENCY");
  assert.equal(byId.get("first-paying-client")?.status, "PENDING_DEPENDENCY");
  assert.equal(byId.get("first-paying-client")?.dependency, "Step 11");
  assert.equal(byId.get("formal-release")?.status, "PENDING_DEPENDENCY");
  assert.equal(byId.get("formal-release")?.blocking, false);

  for (const gate of manifest.gates.filter(gate => gate.blocking && gate.status !== "READY")) {
    assert.ok(gate.nextAction, `${gate.id} must describe the action required to clear the blocker`);
  }
});

test("launch manifest structural validator succeeds while hard GO correctly fails under HOLD", () => {
  execFileSync(process.execPath, [fileURLToPath(scriptUrl)], { stdio: "pipe", cwd: fileURLToPath(new URL("../../../../", import.meta.url)) });
  const hardGate = spawnSync(process.execPath, [fileURLToPath(scriptUrl), "--require-go"], {
    encoding: "utf8",
    cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
  });
  assert.equal(hardGate.status, 1);
  assert.match(hardGate.stdout + hardGate.stderr, /Commercial launch is HOLD/);
});

test("CI and manual workflow both enforce the controlled readiness source", async () => {
  const [ci, workflow, pkg] = await Promise.all([
    readFile(ciUrl, "utf8"),
    readFile(workflowUrl, "utf8"),
    readFile(packageUrl, "utf8"),
  ]);
  assert.match(ci, /Validate launch readiness manifest/);
  assert.match(ci, /pnpm launch:check/);
  assert.match(workflow, /Launch readiness gate/);
  assert.match(workflow, /pnpm launch:require-go/);
  assert.match(workflow, /enforce_go/);
  assert.match(pkg, /"launch:check"/);
  assert.match(pkg, /"launch:require-go"/);
});

test("launch documents preserve critical operational and legal no-go controls", async () => {
  const [readiness, launchDay] = await Promise.all([
    readFile(readinessDocUrl, "utf8"),
    readFile(launchDayUrl, "utf8"),
  ]);
  assert.match(readiness, /\*\*Current launch decision:\*\* \*\*HOLD\*\*/);
  assert.match(readiness, /Step 5 — Off-site Backup & Disaster Recovery/);
  assert.match(readiness, /Step 11 — First Real Paying Client/);
  assert.match(readiness, /Public Privacy \/ Terms \/ AUP publication/);
  assert.match(readiness, /Do not infer or invent these values/);
  assert.match(readiness, /Step 14 control framework can be complete while the overall commercial launch remains HOLD/);

  assert.match(launchDay, /pnpm launch:require-go/);
  assert.match(launchDay, /Final GO \/ NO-GO/);
  assert.match(launchDay, /Rollback trigger/);
  assert.match(launchDay, /First 24 hours/);
  assert.match(launchDay, /INCIDENT_RESPONSE/);
});

test("public legal publication blocker matches current SaaS landing surface", async () => {
  const [manifestRaw, landing] = await Promise.all([
    readFile(manifestUrl, "utf8"),
    readFile(landingUrl, "utf8"),
  ]);
  const manifest = JSON.parse(manifestRaw) as { gates: Array<{ id: string; status: string }> };
  const legalGate = manifest.gates.find(gate => gate.id === "public-legal-pages");
  assert.ok(legalGate);

  const hasApprovedLegalLinks =
    /href=["']\/privacy["']/.test(landing) &&
    /href=["']\/terms["']/.test(landing);

  if (legalGate!.status === "READY") assert.equal(hasApprovedLegalLinks, true);
  else assert.equal(hasApprovedLegalLinks, false);
});
