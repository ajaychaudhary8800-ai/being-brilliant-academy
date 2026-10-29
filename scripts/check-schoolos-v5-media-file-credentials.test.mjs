import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const composeUrl = new URL("../docker-compose.schoolos-v5-staging.yml", import.meta.url);
const entrypointUrl = new URL("../apps/api/docker-entrypoint.sh", import.meta.url);
const hostFile = "/etc/schoolos/v5-staging/livekit-v5-api.env";
const containerFile = "/run/secrets/schoolos-v5-livekit-api.env";
const fixture = [
  "LIVEKIT_URL=wss://fixture.invalid",
  "LIVEKIT_API_KEY=fixture-key",
  "LIVEKIT_API_SECRET=fixture-private-secret",
  "LIVEKIT_RECORDING_S3_BUCKET=fixture-storage",
  "LIVEKIT_RECORDING_S3_ENDPOINT=https://example.invalid",
  "LIVEKIT_RECORDING_S3_ACCESS_KEY_ID=fixture-access",
  "LIVEKIT_RECORDING_S3_SECRET_ACCESS_KEY=fixture-storage-secret",
].join("\n") + "\n";

test("isolated V5 Compose pins pre-existing Coolify volumes without recreation", async () => {
  const compose = await readFile(composeUrl, "utf8");
  for (const [key, actual] of Object.entries({
    postgres_data: "postgres-data",
    redis_data: "redis-data",
    app_storage: "app-storage",
    backups: "backups",
  })) {
    const statement = key + ": { external: true, name: 96ffcu0jinuwlnaqxpltln4p_" + actual + " }";
    assert.ok(compose.includes(statement), "missing exact existing volume pin: " + key);
  }
});

test("only V5 staging API has the private provider mount", async () => {
  const compose = await readFile(composeUrl, "utf8");
  assert.equal(compose.split(hostFile).length - 1, 1);
  const servicePart = compose.split("\nservices:")[1]?.split("\nnetworks:")[0];
  assert.ok(servicePart);
  const api = servicePart.split("\n  api:\n")[1]?.split("\n  web:\n")[0];
  assert.ok(api?.includes(hostFile + ":" + containerFile + ":ro"));
  assert.ok(api?.includes("SCHOOLOS_V5_LIVEKIT_ENV_FILE: " + containerFile));
  assert.doesNotMatch(compose, /LIVEKIT_API_SECRET:|LIVEKIT_RECORDING_S3_SECRET_ACCESS_KEY:/);
});

test("one-shot V5 Prisma migration has only database and execution-mode env", async () => {
  const compose = await readFile(composeUrl, "utf8");
  const services = compose.split("\nservices:")[1]?.split("\nnetworks:")[0];
  const migrate = services?.split("\n  migrate:\n")[1]?.split("\n  api:\n")[0];
  const api = services?.split("\n  api:\n")[1]?.split("\n  web:\n")[0];
  assert.ok(migrate && api, "expected distinct migration and API service");
  assert.match(migrate, /command: \["node", "scripts\/prisma-run\.mjs", "migrate", "deploy"\]/);
  assert.doesNotMatch(migrate, /environment:\s*\*api-env/);
  const env = migrate.match(/\n    environment:\n((?:      [^\n]+\n)+)/);
  assert.ok(env, "migration env mapping missing");
  const keys = [...env[1].matchAll(/^      ([A-Z][A-Z0-9_]*):/gm)].map(match => match[1]);
  assert.deepEqual(keys, ["NODE_ENV", "DATABASE_URL"]);
  assert.match(env[1], /DATABASE_URL: \$\{DATABASE_URL\}/);
  assert.match(api, /<<: \*api-env/, "API must retain complete runtime environment");
});


const appHostFile = "/etc/schoolos/v5-staging/app-v5-api.env";
const appContainerFile = "/run/secrets/schoolos-v5-app-api.env";
const appFixture = [
  "JWT_ACCESS_SECRET=original-access-fixture-123456789012345",
  "JWT_REFRESH_SECRET=original-refresh-fixture-12345678901234",
  'SMTP_PASSWORD="mail-secret-unchanged"',
  "COMMERCIAL_DOCUMENT_ENCRYPTION_KEY=original-vault-fixture-123456789012345",
].join("\n") + "\n";

test("V5 staging uses an API-only protected file for the four existing auth/mail/Vault keys", async () => {
  const compose = await readFile(composeUrl, "utf8");
  const shared = compose.split("\nservices:")[0];
  const block = compose.split("\nservices:")[1]?.split("\nnetworks:")[0];
  const api = block?.split("\n  api:\n")[1]?.split("\n  web:\n")[0];
  assert.ok(api);
  assert.equal(compose.split(appHostFile).length - 1, 1);
  assert.ok(api.includes(appHostFile + ":" + appContainerFile + ":ro"));
  assert.ok(api.includes("SCHOOLOS_V5_APP_ENV_FILE: " + appContainerFile));
  for (const key of [
    "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "SMTP_PASSWORD",
    "COMMERCIAL_DOCUMENT_ENCRYPTION_KEY",
  ]) {
    assert.match(shared, new RegExp("^  " + key + ': ""
  const dir = await mkdtemp(join(tmpdir(), "schoolos-v5-media-"));
  const file = join(dir, "media.env");
  try {
    if (media !== null) await writeFile(file, media, { mode: 0o600 });
    const original = await readFile(entrypointUrl, "utf8");
    const script = original
      .replaceAll(containerFile, file)
      .replace('exec su-exec app "$@"', [
        '[ "$LIVEKIT_API_SECRET" = "fixture-private-secret" ]',
        '[ "$LIVEKIT_RECORDING_S3_SECRET_ACCESS_KEY" = "fixture-storage-secret" ]',
      ].join(" && "));
    const r = spawnSync("sh", ["-c", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        STORAGE_DRIVER: "s3",
        SCHOOLOS_V5_LIVEKIT_ENV_FILE: file,
        SCHOOLOS_V5_RAZORPAY_ENV_FILE: "",
        LIVEKIT_API_SECRET: "obsolete-globally-injected-value",
        ...changes,
      },
    });
    return { status: r.status, output: (r.stdout || "") + (r.stderr || "") };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("API loader overrides obsolete globally injected values with protected file", async () => {
  const r = await runEntrypoint(fixture);
  assert.equal(r.status, 0, r.output);
  assert.equal(r.output, "");
});

test("missing, duplicate and unsupported secret file records fail closed", async () => {
  for (const value of [
    null,
    fixture.replace(/LIVEKIT_API_SECRET=.*\n/, ""),
    fixture + "LIVEKIT_API_KEY=duplicate\n",
    fixture + "UNEXPECTED_SECRET=bad\n",
  ]) {
    const r = await runEntrypoint(value);
    assert.notEqual(r.status, 0);
    assert.ok(!r.output.includes("fixture-private-secret"));
    assert.ok(!r.output.includes("fixture-storage-secret"));
  }
});

test("provider file is treated as literal data rather than evaluated shell", async () => {
  const r = await runEntrypoint(fixture.replace("fixture-key", "$(exit 75)"));
  assert.equal(r.status, 0);
});
, "m"));
    assert.doesNotMatch(shared, new RegExp("^  " + key + ": \\$\\{", "m"));
  }
  assert.equal((compose.match(/external: true/g) ?? []).length, 4);
});

async function runAppEntrypoint(content, injected = {}) {
  const dir = await mkdtemp(join(tmpdir(), "schoolos-v5-app-"));
  const file = join(dir, "app.env");
  try {
    if (content !== null) await writeFile(file, content, { mode: 0o600 });
    const original = await readFile(entrypointUrl, "utf8");
    const script = original.replaceAll(appContainerFile, file)
      .replace('exec su-exec app "$@"', [
        '[ "$JWT_ACCESS_SECRET" = "original-access-fixture-123456789012345" ]',
        '[ "$JWT_REFRESH_SECRET" = "original-refresh-fixture-12345678901234" ]',
        '[ "$SMTP_PASSWORD" = "mail-secret-unchanged" ]',
        '[ "$COMMERCIAL_DOCUMENT_ENCRYPTION_KEY" = "original-vault-fixture-123456789012345" ]',
      ].join(" && "));
    const result = spawnSync("sh", ["-c", script], {
      env: {
        ...process.env, STORAGE_DRIVER: "s3",
        SCHOOLOS_V5_RAZORPAY_ENV_FILE: "",
        SCHOOLOS_V5_LIVEKIT_ENV_FILE: "",
        SCHOOLOS_V5_APP_ENV_FILE: file,
        JWT_ACCESS_SECRET: "obsolete-coolify-access",
        JWT_REFRESH_SECRET: "obsolete-coolify-refresh",
        SMTP_PASSWORD: "obsolete-coolify-smtp",
        COMMERCIAL_DOCUMENT_ENCRYPTION_KEY: "obsolete-coolify-vault",
        ...injected,
      }, encoding: "utf8", timeout: 5000,
    });
    return { status: result.status, output: (result.stdout ?? "") + (result.stderr ?? "") };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("app loader preserves original four credentials while overriding injected values", async () => {
  const result = await runAppEntrypoint(appFixture);
  assert.equal(result.status, 0, result.output);
  assert.equal(result.output, "");
});

test("app loader fails closed for missing, duplicate, empty, unexpected or incorrect path", async () => {
  for (const [content, injected] of [
    [null, {}],
    [appFixture.replace(/^JWT_REFRESH_SECRET=.*\n/m, ""), {}],
    [appFixture + "SMTP_PASSWORD=duplicate\n", {}],
    [appFixture.replace(/SMTP_PASSWORD="[^"]*"/, "SMTP_PASSWORD="), {}],
    [appFixture + "UNSUPPORTED_SECRET=value\n", {}],
    [appFixture, { SCHOOLOS_V5_APP_ENV_FILE: "/tmp/unexpected-path" }],
  ]) {
    const result = await runAppEntrypoint(content, injected);
    assert.notEqual(result.status, 0);
    assert.ok(!result.output.includes("original-vault-fixture"));
    assert.ok(!result.output.includes("original-access-fixture"));
    assert.ok(!result.output.includes("obsolete-coolify"));
  }
});

test("app credential loader does not execute embedded shell substitutions", async () => {
  const result = await runAppEntrypoint(appFixture.replace(
    "original-access-fixture-123456789012345", "$(exit 75)"));
  assert.notEqual(result.status, 0);
  assert.equal(result.output, "");
});

async function runEntrypoint(media, changes = {}) {
  const dir = await mkdtemp(join(tmpdir(), "schoolos-v5-media-"));
  const file = join(dir, "media.env");
  try {
    if (media !== null) await writeFile(file, media, { mode: 0o600 });
    const original = await readFile(entrypointUrl, "utf8");
    const script = original
      .replaceAll(containerFile, file)
      .replace('exec su-exec app "$@"', [
        '[ "$LIVEKIT_API_SECRET" = "fixture-private-secret" ]',
        '[ "$LIVEKIT_RECORDING_S3_SECRET_ACCESS_KEY" = "fixture-storage-secret" ]',
      ].join(" && "));
    const r = spawnSync("sh", ["-c", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        STORAGE_DRIVER: "s3",
        SCHOOLOS_V5_LIVEKIT_ENV_FILE: file,
        SCHOOLOS_V5_RAZORPAY_ENV_FILE: "",
        LIVEKIT_API_SECRET: "obsolete-globally-injected-value",
        ...changes,
      },
    });
    return { status: r.status, output: (r.stdout || "") + (r.stderr || "") };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("API loader overrides obsolete globally injected values with protected file", async () => {
  const r = await runEntrypoint(fixture);
  assert.equal(r.status, 0, r.output);
  assert.equal(r.output, "");
});

test("missing, duplicate and unsupported secret file records fail closed", async () => {
  for (const value of [
    null,
    fixture.replace(/LIVEKIT_API_SECRET=.*\n/, ""),
    fixture + "LIVEKIT_API_KEY=duplicate\n",
    fixture + "UNEXPECTED_SECRET=bad\n",
  ]) {
    const r = await runEntrypoint(value);
    assert.notEqual(r.status, 0);
    assert.ok(!r.output.includes("fixture-private-secret"));
    assert.ok(!r.output.includes("fixture-storage-secret"));
  }
});

test("provider file is treated as literal data rather than evaluated shell", async () => {
  const r = await runEntrypoint(fixture.replace("fixture-key", "$(exit 75)"));
  assert.equal(r.status, 0);
});
