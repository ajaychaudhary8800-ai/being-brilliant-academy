#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(process.cwd());
const manifestPath = resolve(root, "config/erp4-software-readiness.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const allowedStatuses = new Set(["READY", "INCOMPLETE"]);
const errors = [];
const ids = new Set();

if (manifest.schemaVersion !== 1) errors.push("schemaVersion must be 1");
if (manifest.version !== "4.0") errors.push("version must be 4.0");
if (!Array.isArray(manifest.gates) || manifest.gates.length === 0) errors.push("gates must be a non-empty array");

for (const gate of manifest.gates ?? []) {
  if (!gate.id || typeof gate.id !== "string") errors.push("every gate must have an id");
  else if (ids.has(gate.id)) errors.push(`duplicate gate id: ${gate.id}`);
  else ids.add(gate.id);

  if (!allowedStatuses.has(gate.status)) errors.push(`${gate.id}: invalid status ${gate.status}`);
  if (!Array.isArray(gate.evidence) || gate.evidence.length === 0) {
    errors.push(`${gate.id}: at least one evidence path is required`);
    continue;
  }
  for (const evidence of gate.evidence) {
    try {
      await access(resolve(root, evidence), constants.R_OK);
    } catch {
      errors.push(`${gate.id}: evidence path missing or unreadable: ${evidence}`);
    }
  }
}

const incomplete = (manifest.gates ?? []).filter(gate => gate.status !== "READY");
const computedStatus = incomplete.length === 0 ? "READY" : "INCOMPLETE";
if (manifest.declaredStatus !== computedStatus) {
  errors.push(`declaredStatus=${manifest.declaredStatus} but computed software status is ${computedStatus}`);
}

const readyCount = (manifest.gates ?? []).filter(gate => gate.status === "READY").length;
const total = manifest.gates?.length ?? 0;
console.log(`ERP 4.0 software readiness: ${computedStatus}`);
console.log(`Ready software gates: ${readyCount}/${total}`);
console.log("Commercial/legal launch readiness is tracked separately in config/launch-readiness.json.");

if (incomplete.length) {
  console.log("Incomplete software gates:");
  for (const gate of incomplete) console.log(`- ${gate.id}: ${gate.name}`);
}

if (errors.length) {
  console.error("ERP 4.0 software-readiness manifest errors:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(2);
}

if (process.argv.includes("--require-ready") && computedStatus !== "READY") {
  console.error("ERP 4.0 software release is not ready.");
  process.exit(1);
}
