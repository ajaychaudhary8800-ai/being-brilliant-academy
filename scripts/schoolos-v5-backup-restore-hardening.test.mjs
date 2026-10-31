import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const scripts = ["backup.sh", "restore.sh", "entrypoint.sh", "healthcheck.sh"];
const dockerfile = readFileSync(resolve(root, "infra/backup/Dockerfile"), "utf8");
const attrs = readFileSync(resolve(root, ".gitattributes"), "utf8");
const restore = readFileSync(resolve(root, "infra/backup/restore.sh"), "utf8");

test("all four backup/restore executable shell scripts are LF and POSIX parseable", () => {
  for (const script of scripts) {
    const path = resolve(root, "infra/backup", script);
    const raw = readFileSync(path);
    assert.equal(raw.subarray(0, 10).toString(), "#!/bin/sh\n", script);
    assert.equal(raw.includes(13), false, script);
    const check = spawnSync("/bin/sh", ["-n", path], { encoding: "utf8" });
    assert.equal(check.status, 0, script);
  }
});

test("all four backup scripts are pinned to LF on Windows Git checkout", () => {
  for (const name of scripts) {
    assert.ok(attrs.split("\n").includes("infra/backup/" + name + " text eol=lf"), name);
  }
});

test("Dockerfile fails the image build for a malformed backup/restore shell file", () => {
  assert.match(dockerfile, /COPY backup\.sh restore\.sh entrypoint\.sh healthcheck\.sh \/usr\/local\/bin\//);
  assert.match(dockerfile, /sed -i 's\/\\r\$\/\/' "\$file"/);
  assert.match(dockerfile, /\/bin\/sh -n "\$file"/);
  assert.match(dockerfile, /test -x "\$file"/);
  assert.match(dockerfile, /ENTRYPOINT \["\/usr\/local\/bin\/entrypoint\.sh"\]/);
});

test("normalization accepts CRLF fixture but still rejects malformed shell", () => {
  const temp = mkdtempSync(join(tmpdir(), "v5-backup-lf-"));
  try {
    for (const [name, content, expectValid] of [
      ["valid.sh", "#!/bin/sh\r\nif true; then\r\n :\r\nfi\r\n", true],
      ["invalid.sh", "#!/bin/sh\r\nif true; then\r\n", false],
    ]) {
      const file = join(temp, name);
      writeFileSync(file, content);
      const converted = spawnSync("sed", ["-i", "s/\\r$//", file], { encoding: "utf8" });
      assert.equal(converted.status, 0);
      assert.equal(readFileSync(file).includes(13), false);
      const check = spawnSync("/bin/sh", ["-n", file], { encoding: "utf8" });
      assert.equal(check.status === 0, expectValid);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("pg_restore strips only Prisma schema selector without exposing connection string", () => {
  const begin = restore.indexOf('pg_restore_url="$(printf');
  const end = restore.indexOf('\npg_restore --clean', begin);
  assert.ok(begin >= 0 && end > begin, "restore URL normalization must exist");
  assert.match(restore.slice(end), /--dbname="\$pg_restore_url"/);
  const extractor = restore.slice(begin, end) + '\nprintf "%s\\n" "$pg_restore_url"\n';
  const cases = [
    ["postgresql://local:synthetic@pg/db?schema=public", "postgresql://local:synthetic@pg/db"],
    ["postgresql://local:synthetic@pg/db?schema=public&sslmode=disable", "postgresql://local:synthetic@pg/db?sslmode=disable"],
    ["postgresql://local:synthetic@pg/db?sslmode=disable&schema=public", "postgresql://local:synthetic@pg/db?sslmode=disable"],
    ["postgresql://local:synthetic@pg/db?sslmode=disable&schema=public&application_name=restore", "postgresql://local:synthetic@pg/db?sslmode=disable&application_name=restore"],
    ["postgresql://local:synthetic@pg/db?sslmode=disable", "postgresql://local:synthetic@pg/db?sslmode=disable"],
  ];
  for (const [input, expected] of cases) {
    const result = spawnSync("/bin/sh", ["-c", extractor], {
      encoding: "utf8",
      env: { DATABASE_URL: input },
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), expected);
  }
});

test("restore keeps checksum validation before any database or file writes", () => {
  const checks = restore.indexOf('sha256sum -c "$backup_dir/SHA256SUMS"');
  const pg = restore.indexOf("pg_restore --clean ");
  const files = restore.indexOf('tar -xzf "$backup_dir/files.tar.gz"');
  assert.ok(checks > 0 && checks < pg && pg < files);
  assert.doesNotMatch(restore, /echo .*DATABASE_URL/);
});
