import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../../", import.meta.url);
const webRoot = new URL("../../../web/", import.meta.url);

test("production compose passes native classroom configuration to API containers", async () => {
  const compose = await readFile(new URL("docker-compose.yml", root), "utf8");
  for (const key of [
    "LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
    "LIVEKIT_RECORDING_PREFIX",
  ]) assert.match(compose, new RegExp(key));
});

test("environment examples document native classroom credentials", async () => {
  const [development, production] = await Promise.all([
    readFile(new URL(".env.example", root), "utf8"),
    readFile(new URL(".env.production.example", root), "utf8"),
  ]);
  for (const source of [development, production]) {
    assert.match(source, /LIVEKIT_URL=/);
    assert.match(source, /LIVEKIT_API_KEY=/);
    assert.match(source, /LIVEKIT_API_SECRET=/);
  }
});

test("integration health and SaaS control center expose native classroom readiness", async () => {
  const [server, livekit, control] = await Promise.all([
    readFile(new URL("../server.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/livekit.ts", import.meta.url), "utf8"),
    readFile(new URL("app/admin/control-center/page.tsx", webRoot), "utf8"),
  ]);
  assert.match(server, /livekitHealth/);
  assert.match(server, /livekit,/);
  assert.match(livekit, /roomList: true/);
  assert.match(livekit, /recordingConfigured/);
  assert.match(control, /Native live classroom/);
  assert.match(control, /recording storage ready/);
});
