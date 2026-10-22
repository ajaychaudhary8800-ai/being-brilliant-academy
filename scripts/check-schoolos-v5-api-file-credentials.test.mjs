import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

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
  assert.match(sections.api, /environment: \*api-env/);
  assert.match(sections.api, /env_file:\s*\n\s*- \/etc\/schoolos\/v5-staging\/razorpay-v5-api\.env/);
  for (const name of names.filter(x => x !== "api")) {
    assert.doesNotMatch(sections[name], /RAZORPAY_(?:KEY_SECRET|WEBHOOK_SECRET)/,
      "Razorpay API secrets must not enter " + name);
  }
});
