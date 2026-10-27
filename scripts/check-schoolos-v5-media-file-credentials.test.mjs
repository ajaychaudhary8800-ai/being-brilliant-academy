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
