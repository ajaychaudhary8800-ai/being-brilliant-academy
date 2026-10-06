import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Device Hub admin status workspace reads governed device data", async () => {
  const page = await readFile(new URL("../app/admin/device-hub/page.tsx", import.meta.url), "utf8");
  assert.match(page, /\/device-hub\/devices/);
  assert.match(page, /\/device-hub\/connectors/);
  assert.match(page, /\/device-hub\/adapters/);
  assert.match(page, /No devices provisioned/);
  assert.match(page, /No connector instances configured/);
});
