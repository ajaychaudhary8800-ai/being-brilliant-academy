#!/usr/bin/env node
/**
 * Narrow V5 FINAL IMAGE dependency sanitation.
 *
 * dotenv v16.6.1's published README documents fake PEM private-key examples.
 * Unlike removing arbitrary PEM-looking files, this gate deletes ONLY the
 * exact independently reviewed upstream README, identified by SHA-256 and
 * canonical relative location. It refuses unexpected package versions,
 * edited READMEs, symlinks, file-location changes or a missing target.
 *
 * Invoked in Docker BUILD stage BEFORE copying node_modules into runtime;
 * deleting a file in the final runtime stage would not erase lower OCI layers.
 * Does not edit app source/config, credential files or actual key material.
 */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, unlinkSync, existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const PINNED_DOTENV_VERSION = "16.6.1";
export const APPROVED_README_SHA256 =
  "d445595efbfa0e290e495cbef75379e5cb16d881489d4873ecb0d0bd2e56227a";
export const APPROVED_RELATIVE_PATH =
  "node_modules/.pnpm/dotenv@16.6.1/node_modules/dotenv/README.md";

export function pruneApprovedDocumentation({
  root,
  relativePath = APPROVED_RELATIVE_PATH,
  expectedDigest = APPROVED_README_SHA256,
} = {}) {
  if (typeof root !== "string" || !root.length ||
      relativePath !== APPROVED_RELATIVE_PATH ||
      !/^[0-9a-f]{64}$/.test(expectedDigest)) {
    return { status: "HOLD_BAD_POLICY" };
  }
  const canonicalRoot = resolve(root);
  const target = resolve(canonicalRoot, relativePath);
  if (!target.startsWith(canonicalRoot + sep)) {
    return { status: "HOLD_OUTSIDE_ROOT" };
  }
  // Failure classes are deliberately boolean-only. Never echo the document,
  // its location, its digest or contents (the README may contain PEM examples).
  if (!existsSync(target)) {
    const virtualStore = resolve(canonicalRoot, "node_modules/.pnpm");
    const exactPackage = resolve(virtualStore, "dotenv@16.6.1/node_modules/dotenv");
    let packageInstalled = false;
    try {
      packageInstalled = lstatSync(exactPackage).isDirectory();
    } catch { /* no package at expected pinned location */ }
    return { status: packageInstalled
      ? "HOLD_PINNED_PACKAGE_DOCUMENT_MISSING"
      : "HOLD_PINNED_PACKAGE_NOT_AT_EXPECTED_LOCATION" };
  }
  try {
    const stat = lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 120_000) {
      return { status: "HOLD_INVALID_DOCUMENT" };
    }
    const resolved = realpathSync(target);
    if (resolved !== target || !resolved.startsWith(canonicalRoot + sep)) {
      return { status: "HOLD_SYMLINKED_DOCUMENT" };
    }
    const doc = readFileSync(target);
    const digest = createHash("sha256").update(doc).digest("hex");
    if (digest !== expectedDigest) return { status: "HOLD_UNKNOWN_DEPENDENCY_CONTENT" };
    // A signed source reference and fixed full-doc hash establish that this
    // is an upstream *documentation example*, not the operator's key.
    // Nothing is printed from the source content.
    unlinkSync(target);
    return { status: "PASS_PINNED_DOCUMENTATION_REMOVED" };
  } catch {
    return { status: "HOLD_DOCUMENT_NOT_VERIFIED" };
  }
}

export function main(argv = process.argv.slice(2)) {
  // Tests call the pure injected root helper; Docker invokes this CLI with no
  // args from its fixed /workspace working directory. No uncontrolled paths.
  if (argv.length !== 0 || process.cwd() !== "/workspace") {
    console.log("V5_DEPENDENCY_DOCUMENT_PRUNE=HOLD_CONTEXT");
    return 2;
  }
  const result = pruneApprovedDocumentation({ root: "/workspace" });
  console.log("V5_DEPENDENCY_DOCUMENT_PRUNE=" + result.status);
  console.log("REAL_CREDENTIALS_TOUCHED=NO");
  console.log("SOURCE_TO_OCI_SIGNED_PROVENANCE=NOT_ATTESTED");
  return result.status === "PASS_PINNED_DOCUMENTATION_REMOVED" ? 0 : 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main();
}
