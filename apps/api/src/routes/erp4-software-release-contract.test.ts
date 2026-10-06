import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const rootUrl = new URL("../../../../", import.meta.url);
const root = fileURLToPath(rootUrl);
const softwareManifestUrl = new URL("../../../../config/erp4-software-readiness.json", import.meta.url);
const commercialManifestUrl = new URL("../../../../config/launch-readiness.json", import.meta.url);
const scriptUrl = new URL("../../../../scripts/check-erp4-software-readiness.mjs", import.meta.url);
const ciUrl = new URL("../../../../.github/workflows/ci.yml", import.meta.url);
const packageUrl = new URL("../../../../package.json", import.meta.url);

test("ERP 4.0 software release manifest is fully READY with readable evidence", async () => {
  const manifest = JSON.parse(await readFile(softwareManifestUrl, "utf8")) as {
    version: string;
    declaredStatus: string;
    gates: Array<{ id: string; status: string; evidence: string[] }>;
  };
  assert.equal(manifest.version, "4.0");
  assert.equal(manifest.declaredStatus, "READY");
  assert.ok(manifest.gates.length >= 10);
  assert.ok(manifest.gates.every(gate => gate.status === "READY"));
  for (const gate of manifest.gates) {
    assert.ok(gate.evidence.length > 0, `${gate.id} must have evidence`);
    for (const evidence of gate.evidence) {
      await access(new URL(`../../../../${evidence}`, import.meta.url), constants.R_OK);
    }
  }
});

test("ERP 4.0 software READY remains distinct from commercial launch HOLD", async () => {
  const [softwareRaw, commercialRaw] = await Promise.all([
    readFile(softwareManifestUrl, "utf8"),
    readFile(commercialManifestUrl, "utf8"),
  ]);
  const software = JSON.parse(softwareRaw) as { declaredStatus: string };
  const commercial = JSON.parse(commercialRaw) as { declaredStatus: string };
  assert.equal(software.declaredStatus, "READY");
  assert.equal(commercial.declaredStatus, "HOLD");
});

test("ERP 4.0 software readiness hard gate succeeds", () => {
  execFileSync(process.execPath, [fileURLToPath(scriptUrl), "--require-ready"], {
    cwd: root,
    stdio: "pipe",
  });
});

test("CI enforces ERP 4.0 software readiness independently of commercial launch validation", async () => {
  const [ci, pkg] = await Promise.all([readFile(ciUrl, "utf8"), readFile(packageUrl, "utf8")]);
  assert.match(ci, /Validate ERP 4\.0 software release readiness/);
  assert.match(ci, /pnpm software:release:require-ready/);
  assert.match(pkg, /"software:release:check"/);
  assert.match(pkg, /"software:release:require-ready"/);
  assert.match(ci, /pnpm launch:check/);
});
