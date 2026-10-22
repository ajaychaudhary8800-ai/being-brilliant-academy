import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const path = new URL("../docker-compose.schoolos-v5-staging.yml", import.meta.url);
const names = ["postgres", "redis", "migrate", "api", "web", "nginx", "backup"];
const hostFile = "/etc/schoolos/v5-staging/razorpay-v5-api.env";

test("V5 Razorpay API secrets never appear in shared Compose environment", async () => {
  const compose = await readFile(path, "utf8");
  const [shared] = compose.split("\nservices:");
  assert.ok(shared?.includes("x-api-env: &api-env"));
  assert.doesNotMatch(shared, /RAZORPAY_(?:KEY_SECRET|WEBHOOK_SECRET):/);
  assert.equal(compose.split(hostFile).length - 1, 1,
    "A protected Razorpay credential file can only be loaded by one service");
});

test("V5 Razorpay protected credentials are attached to api alone, never migrate or backup", async () => {
  const compose = await readFile(path, "utf8");
  const block = compose.split("\nservices:")[1]?.split("\nnetworks:")[0];
  assert.ok(block, "Compose services missing");
  const sections = Object.fromEntries(names.map((name, i) => {
    const begin = block.indexOf("\n  " + name + ":\n");
    const end = i + 1 < names.length
      ? block.indexOf("\n  " + names[i + 1] + ":\n", begin + 1)
      : block.length;
    assert.ok(begin >= 0 && end > begin, "Missing service " + name);
    return [name, block.slice(begin, end)];
  }));
  const exposed = Object.entries(sections)
    .filter(([, section]) => section.includes(hostFile))
    .map(([name]) => name);
  assert.deepEqual(exposed, ["api"]);
  assert.match(sections.api, /<<: \*api-env/);
  assert.match(sections.api, /SCHOOLOS_V5_RAZORPAY_ENV_FILE: \/run\/secrets\/schoolos-v5-razorpay-api\.env/);
  assert.match(sections.api, /\/etc\/schoolos\/v5-staging\/razorpay-v5-api\.env:\/run\/secrets\/schoolos-v5-razorpay-api\.env:ro/);
  for (const name of names.filter(x => x !== "api")) {
    assert.doesNotMatch(sections[name], /RAZORPAY_(?:KEY_SECRET|WEBHOOK_SECRET)/,
      "Razorpay API secrets must not enter " + name);
  }
});

test("API entrypoint overrides empty Coolify variables only on explicitly mounted V5 secrets", async () => {
  const entrypoint = await readFile(new URL("../apps/api/docker-entrypoint.sh", import.meta.url), "utf8");
  assert.match(entrypoint, /SCHOOLOS_V5_RAZORPAY_ENV_FILE/);
  assert.match(entrypoint, /RAZORPAY_KEY_SECRET=\*/);
  assert.match(entrypoint, /RAZORPAY_WEBHOOK_SECRET=\*/);
  assert.match(entrypoint, /export "\$key=\$value"/);
  assert.match(entrypoint, /exec su-exec app "\$@"/);
});

test("V5 entrypoint loads quoted credentials over empty injected values without evaluating file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "v5-razorpay-fixture-"));
  const filename = join(dir, "credentials.env");
  try {
    await writeFile(filename, 'RAZORPAY_KEY_SECRET="fixture-only-one"\nRAZORPAY_WEBHOOK_SECRET=\'fixture-only-two\'\n', { mode: 0o600 });
    const original = await readFile(new URL("../apps/api/docker-entrypoint.sh", import.meta.url), "utf8");
    const replacement = original
      .replaceAll("/run/secrets/schoolos-v5-razorpay-api.env", filename)
      .replace('exec su-exec app "$@"', '[ "$RAZORPAY_KEY_SECRET" = "fixture-only-one" ] && [ "$RAZORPAY_WEBHOOK_SECRET" = "fixture-only-two" ]');
    const result = spawnSync("sh", ["-c", replacement], {
      env: {
        ...process.env,
        STORAGE_DRIVER: "s3",
        SCHOOLOS_V5_RAZORPAY_ENV_FILE: filename,
        RAZORPAY_KEY_SECRET: "",
        RAZORPAY_WEBHOOK_SECRET: ""
      },
      encoding: "utf8"
    });
    assert.equal(result.status, 0, "V5 entrypoint must override empty variables from protected file");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
