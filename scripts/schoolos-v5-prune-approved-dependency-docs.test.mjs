import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  APPROVED_RELATIVE_PATH, APPROVED_README_SHA256,
  APPROVED_RELATIVE_PATH_ES, APPROVED_README_ES_SHA256, PINNED_DOTENV_VERSION,
  pruneApprovedDocumentation, main,
} from "./schoolos-v5-prune-approved-dependency-docs.mjs";

function withFixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "v5-fake-upstream-doc-"));
  const filename = join(root, APPROVED_RELATIVE_PATH);
  mkdirSync(dirname(filename), { recursive: true });
  try { fn(root, filename); } finally { rmSync(root, { recursive: true, force: true }); }
}
const hash = x => createHash("sha256").update(x).digest("hex");

test("upstream public version and full-document SHA are pinned, not auto-allowlisted", () => {
  assert.equal(PINNED_DOTENV_VERSION, "16.6.1");
  assert.match(APPROVED_README_SHA256, /^[0-9a-f]{64}$/);
  assert.equal(APPROVED_RELATIVE_PATH,
    "node_modules/.pnpm/dotenv@16.6.1/node_modules/dotenv/README.md");
});

test("exactly matching disposable document is removed before runtime package copy", () => {
  withFixture((root, filename) => {
    const fake = 'Docs: PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\nKh9NV...';
    writeFileSync(filename, fake);
    const r = pruneApprovedDocumentation({ root, expectedDigest: hash(fake) });
    assert.equal(r.status, "PASS_PINNED_DOCUMENTATION_REMOVED");
    assert.equal(existsSync(filename), false);
  });
});

test("Spanish README candidate has independently pinned full-document SHA and path", () => {
  assert.equal(APPROVED_RELATIVE_PATH_ES,
    "node_modules/.pnpm/dotenv@16.6.1/node_modules/dotenv/README-es.md");
  assert.equal(APPROVED_README_ES_SHA256,
    "a7021cf039feb04752c5cde82f07336dec6e17876e88677d7c5de4c2dbbbcff1");
});

test("exact-hash Spanish public documentation can be removed without touching English", () => {
  withFixture((root, english) => {
    const spanish = join(root, APPROVED_RELATIVE_PATH_ES);
    const upstreamExample = 'Documentacion publica con sintesis de clave de muestra';
    writeFileSync(english, "English public text remains");
    writeFileSync(spanish, upstreamExample);
    const result = pruneApprovedDocumentation({
      root,
      relativePath: APPROVED_RELATIVE_PATH_ES,
      expectedDigest: hash(upstreamExample),
    });
    assert.equal(result.status, "PASS_PINNED_DOCUMENTATION_REMOVED");
    assert.equal(existsSync(spanish), false);
    assert.equal(readFileSync(english, "utf8"), "English public text remains");
  });
});

test("modified Spanish README is refused and retained", () => {
  withFixture((root, english) => {
    const spanish = join(root, APPROVED_RELATIVE_PATH_ES);
    writeFileSync(spanish, "SYNTHETIC-DO-NOT-DELETE-PRIVATE-KEY");
    const result = pruneApprovedDocumentation({
      root, relativePath: APPROVED_RELATIVE_PATH_ES,
      expectedDigest: APPROVED_README_ES_SHA256,
    });
    assert.equal(result.status, "HOLD_UNKNOWN_DEPENDENCY_CONTENT");
    assert.equal(readFileSync(spanish, "utf8"), "SYNTHETIC-DO-NOT-DELETE-PRIVATE-KEY");
  });
});

test("arbitrary same-path PEM text fails closed without unlinking any file", () => {
  withFixture((root, filename) => {
    const sensitive = "synthetic-DO-NOT-REMOVE-user-data\n-----BEGIN PRIVATE KEY-----";
    writeFileSync(filename, sensitive);
    const r = pruneApprovedDocumentation({ root });
    assert.equal(r.status, "HOLD_UNKNOWN_DEPENDENCY_CONTENT");
    assert.equal(readFileSync(filename, "utf8"), sensitive);
  });
});

test("different versions, arbitrary paths and missing targets cannot be auto-cleared", () => {
  withFixture((root, filename) => {
    writeFileSync(filename, "fictional-content");
    assert.equal(pruneApprovedDocumentation({
      root,
      relativePath: "node_modules/.pnpm/dotenv@17.0.0/node_modules/dotenv/README.md",
      expectedDigest: hash("fictional-content"),
    }).status, "HOLD_BAD_POLICY");
    assert.equal(pruneApprovedDocumentation({
      root, relativePath: "../outside/secret", expectedDigest: hash("fictional-content"),
    }).status, "HOLD_BAD_POLICY");
    rmSync(filename);
    assert.equal(pruneApprovedDocumentation({ root }).status, "HOLD_PINNED_PACKAGE_DOCUMENT_MISSING");
  });
});

test("missing exact pinned package and missing README are distinct fail-closed states", () => {
  withFixture((root, filename) => {
    rmSync(dirname(filename), { recursive: true, force: true });
    assert.equal(pruneApprovedDocumentation({ root }).status,
      "HOLD_PINNED_PACKAGE_NOT_AT_EXPECTED_LOCATION");
    mkdirSync(dirname(filename), { recursive: true });
    assert.equal(pruneApprovedDocumentation({ root }).status,
      "HOLD_PINNED_PACKAGE_DOCUMENT_MISSING");
  });
});

test("symlinked README and content outside approved package are never deleted", () => {
  withFixture((root, filename) => {
    const other = join(root, "synthetic-not-approved.txt");
    writeFileSync(other, "not a published README");
    symlinkSync(other, filename);
    const verdict = pruneApprovedDocumentation({
      root, expectedDigest: hash(readFileSync(other)),
    });
    assert.equal(verdict.status, "HOLD_INVALID_DOCUMENT");
    assert.equal(readFileSync(other, "utf8"), "not a published README");
  });
});

test("CLI outside the exact Docker build context rejects instead of deleting", () => {
  assert.equal(main([]), 2);
  assert.equal(main(["/workspace/other"]), 2);
});
