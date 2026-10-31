import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const scripts = ["backup.sh", "restore.sh", "entrypoint.sh", "healthcheck.sh", "verify-checksums.sh"];
const dockerfile = readFileSync(resolve(root, "infra/backup/Dockerfile"), "utf8");
const attrs = readFileSync(resolve(root, ".gitattributes"), "utf8");
const restore = readFileSync(resolve(root, "infra/backup/restore.sh"), "utf8");

test("all five backup/restore executable shell scripts are LF and POSIX parseable", () => {
  for (const script of scripts) {
    const path = resolve(root, "infra/backup", script);
    const raw = readFileSync(path);
    assert.equal(raw.subarray(0, 10).toString(), "#!/bin/sh\n", script);
    assert.equal(raw.includes(13), false, script);
    const check = spawnSync("/bin/sh", ["-n", path], { encoding: "utf8" });
    assert.equal(check.status, 0, script);
  }
});

test("all five backup scripts are pinned to LF on Windows Git checkout", () => {
  for (const name of scripts) {
    assert.ok(attrs.split("\n").includes("infra/backup/" + name + " text eol=lf"), name);
  }
});

test("Dockerfile fails the image build for a malformed backup/restore shell file", () => {
  assert.match(dockerfile, /COPY backup\.sh restore\.sh entrypoint\.sh healthcheck\.sh verify-checksums\.sh \/usr\/local\/bin\//);
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
  const checks = restore.indexOf('/usr/local/bin/verify-checksums.sh "$backup_dir"');
  const pg = restore.indexOf("pg_restore --clean ");
  const files = restore.indexOf('tar -xzf "$backup_dir/files.tar.gz"');
  assert.ok(checks > 0 && checks < pg && pg < files);
  assert.doesNotMatch(restore, /echo .*DATABASE_URL/);
});


test("copied historical absolute-path SHA256SUMS validates by content in isolated location", () => {
  const dir = mkdtempSync(join(tmpdir(), "v5-relocated-manifest-"));
  try {
    const checkpoint = join(dir, "isolated-checkpoint");
    mkdirSync(checkpoint);
    const db = Buffer.from("synthetic-db-dump-not-customer-data");
    const files = Buffer.from("synthetic-files-not-customer-data");
    writeFileSync(join(checkpoint, "database.dump"), db);
    writeFileSync(join(checkpoint, "files.tar.gz"), files);
    const sha = b => createHash("sha256").update(b).digest("hex");
    const d = sha(db);
    const f = sha(files);
    const manifest = join(checkpoint, "SHA256SUMS");
    const verifier = resolve(root, "infra/backup/verify-checksums.sh");
    const good = [
      d + "  /backups/20261031T073407Z/database.dump",
      f + "  /backups/20261031T073407Z/files.tar.gz",
    ];
    const run = () => spawnSync("/bin/sh", [verifier, checkpoint], { encoding: "utf8" });
    writeFileSync(manifest, good.join("\n") + "\n");
    assert.equal(run().status, 0, "historical absolute location must be portable");
    writeFileSync(manifest, [d + "  database.dump", f + "  files.tar.gz"].join("\n") + "\n");
    assert.equal(run().status, 0, "relative location must be accepted");
    writeFileSync(manifest, good.join("\n") + "\n");
    writeFileSync(join(checkpoint, "files.tar.gz"), "tampered-synthetic-fixture");
    assert.notEqual(run().status, 0, "tampering must veto restore");
    writeFileSync(join(checkpoint, "files.tar.gz"), files);
    writeFileSync(manifest, good.concat(good[0]).join("\n") + "\n");
    assert.notEqual(run().status, 0, "duplicate manifest entries must fail");
    writeFileSync(manifest, [good[0], d + "  /other/unexpected.dat"].join("\n") + "\n");
    assert.notEqual(run().status, 0, "unexpected manifest file must fail");
    writeFileSync(manifest, [good[0], "invalid  /backups/files.tar.gz"].join("\n") + "\n");
    assert.notEqual(run().status, 0, "malformed hash must fail");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
