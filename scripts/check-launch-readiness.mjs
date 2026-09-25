#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(process.cwd());
const manifestPath = resolve(root, "config/launch-readiness.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

const allowedStatuses = new Set(["READY", "PENDING_DEPENDENCY", "BLOCKED_EXTERNAL", "DEFERRED_NONBLOCKING"]);
const errors = [];
const ids = new Set();

if (manifest.schemaVersion !== 1) errors.push("schemaVersion must be 1");
if (!Array.isArray(manifest.gates) || manifest.gates.length === 0) errors.push("gates must be a non-empty array");

for (const gate of manifest.gates ?? []) {
  if (!gate.id || typeof gate.id !== "string") errors.push("every gate must have an id");
  else if (ids.has(gate.id)) errors.push(`duplicate gate id: ${gate.id}`);
  else ids.add(gate.id);

  if (!allowedStatuses.has(gate.status)) errors.push(`${gate.id}: invalid status ${gate.status}`);
  if (typeof gate.blocking !== "boolean") errors.push(`${gate.id}: blocking must be boolean`);
  if (!Array.isArray(gate.evidence) || gate.evidence.length === 0) errors.push(`${gate.id}: at least one evidence path is required`);

  for (const evidence of gate.evidence ?? []) {
    try {
      await access(resolve(root, evidence), constants.R_OK);
    } catch {
      errors.push(`${gate.id}: evidence path missing or unreadable: ${evidence}`);
    }
  }

  if (gate.blocking && gate.status !== "READY" && !gate.nextAction) {
    errors.push(`${gate.id}: blocking non-ready gate must have nextAction`);
  }
  if (gate.status === "PENDING_DEPENDENCY" && !gate.dependency) {
    errors.push(`${gate.id}: pending dependency gate must name dependency`);
  }
}

const blockingGates = (manifest.gates ?? []).filter(g => g.blocking);
const blockers = blockingGates.filter(g => g.status !== "READY");
const computedStatus = blockers.length === 0 ? "GO" : "HOLD";

if (manifest.declaredStatus !== computedStatus) {
  errors.push(`declaredStatus=${manifest.declaredStatus} but computed status is ${computedStatus}`);
}

const readyCount = (manifest.gates ?? []).filter(g => g.status === "READY").length;
const total = manifest.gates?.length ?? 0;

console.log(`Launch readiness: ${computedStatus}`);
console.log(`Ready gates: ${readyCount}/${total}`);

if (blockers.length) {
  console.log("Blocking gates:");
  for (const gate of blockers) {
    console.log(`- ${gate.id}: ${gate.name} [${gate.status}]`);
    console.log(`  Next: ${gate.nextAction}`);
  }
}

const downstream = (manifest.gates ?? []).filter(g => !g.blocking && g.status !== "READY");
if (downstream.length) {
  console.log("Downstream/non-blocking pending gates:");
  for (const gate of downstream) console.log(`- ${gate.id}: ${gate.name} [${gate.status}]`);
}

if (errors.length) {
  console.error("Launch-readiness manifest errors:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(2);
}

if (process.argv.includes("--require-go") && computedStatus !== "GO") {
  console.error("Commercial launch is HOLD. Resolve every blocking gate before formal launch.");
  process.exit(1);
}
