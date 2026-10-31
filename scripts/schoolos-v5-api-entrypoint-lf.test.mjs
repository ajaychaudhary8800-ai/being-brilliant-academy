import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "apps/api/docker-entrypoint.sh");
const dockerfile = readFileSync(resolve(root, "apps/api/Dockerfile"), "utf8");
const attrs = readFileSync(resolve(root, ".gitattributes"), "utf8");

test("Git forces LF for V5 API entrypoint only", () => {
  assert.match(attrs, /^apps\/api\/docker-entrypoint\.sh text eol=lf$/m);
});

test("checked-in entrypoint is LF and has valid POSIX shell syntax", () => {
  const raw = readFileSync(source);
  assert.equal(raw.includes(13), false, "repository source must be LF-only");
  assert.equal(raw.subarray(0, 10).toString(), "#!/bin/sh\n");
  const check = spawnSync("/bin/sh", ["-n", source], { encoding: "utf8" });
  assert.equal(check.status, 0, "source must parse as POSIX sh");
});

test("runtime Dockerfile canonicalizes executable before shell syntax/permission checks", () => {
  assert.match(dockerfile, /COPY --chmod=755 apps\/api\/docker-entrypoint\.sh \/usr\/local\/bin\/bba-api-entrypoint\n/);
  assert.match(dockerfile, /RUN sed -i 's\/\\r\$\/\/' \/usr\/local\/bin\/bba-api-entrypoint \\\n    && \/bin\/sh -n \/usr\/local\/bin\/bba-api-entrypoint \\\n    && test -x \/usr\/local\/bin\/bba-api-entrypoint/);
  assert.match(dockerfile, /ENTRYPOINT \["\/sbin\/tini", "--", "\/usr\/local\/bin\/bba-api-entrypoint"\]/);
});

test("CRLF synthetic checkout is normalized using the Dockerfile sed expression", () => {
  const temp = mkdtempSync(join(tmpdir(), "v5-entrypoint-lf-"));
  try {
    const fixture = join(temp, "entrypoint.sh");
    writeFileSync(fixture, "#!/bin/sh\r\nset -eu\r\nif true; then\r\n  :\r\nfi\r\n");
    const before = spawnSync("/bin/sh", ["-n", fixture], { encoding: "utf8" });
    assert.notEqual(before.status, 0, "CRLF shell fixture must be rejected");
    const converted = spawnSync("sed", ["-i", "s/\\r$//", fixture], { encoding: "utf8" });
    assert.equal(converted.status, 0);
    assert.equal(readFileSync(fixture).includes(13), false);
    const after = spawnSync("/bin/sh", ["-n", fixture], { encoding: "utf8" });
    assert.equal(after.status, 0, "normalized shell fixture must parse");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("normalization does not disguise genuinely malformed shell syntax", () => {
  const temp = mkdtempSync(join(tmpdir(), "v5-entrypoint-malformed-"));
  try {
    const fixture = join(temp, "broken.sh");
    writeFileSync(fixture, "#!/bin/sh\r\nif true; then\r\n");
    const converted = spawnSync("sed", ["-i", "s/\\r$//", fixture], { encoding: "utf8" });
    assert.equal(converted.status, 0);
    const after = spawnSync("/bin/sh", ["-n", fixture], { encoding: "utf8" });
    assert.notEqual(after.status, 0, "invalid script must still fail the image build");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
