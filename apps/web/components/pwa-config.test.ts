import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import manifest from "../app/manifest";

const webRoot = resolve(process.cwd(), "apps/web");

test("manifest contains the browser installability fields and valid local icons", () => {
  const value = manifest();
  assert.equal(value.start_url, "/");
  assert.equal(value.scope, "/");
  assert.equal(value.display, "standalone");
  assert.ok(value.name);
  assert.ok(value.short_name);
  for (const size of ["192x192", "512x512"]) {
    const icon = value.icons?.find(item => item.sizes === size && item.type === "image/png" && item.purpose?.includes("any"));
    assert.ok(icon, `${size} PNG icon is required`);
    assert.ok(statSync(resolve(webRoot, "public", String(icon.src).replace(/^\//, ""))).size > 0);
  }
});

test("standalone production image includes public PWA assets", () => {
  const dockerfile = readFileSync(resolve(webRoot, "Dockerfile"), "utf8");
  assert.match(dockerfile, /COPY --from=build .*\/workspace\/apps\/web\/public \.\/apps\/web\/public/);
});

test("service worker provides navigation fallback without intercepting API or data requests", () => {
  const worker = readFileSync(resolve(webRoot, "public/sw.js"), "utf8");
  assert.match(worker, /request\.mode!=="navigate"/);
  assert.doesNotMatch(worker, /caches\.match\(e\.request\)/);
  assert.doesNotMatch(worker, /bba-downloads|\/api\//);
  assert.match(worker, /caches\.match\(OFFLINE\)/);
});
