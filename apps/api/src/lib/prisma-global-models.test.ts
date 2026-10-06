import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("DeviceAdapterRegistry remains global and is excluded from tenant organization scoping", async () => {
  const prismaSource = await readFile(new URL("./prisma.ts", import.meta.url), "utf8");
  const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");

  assert.match(
    prismaSource,
    /const unscoped = new Set\(\[[^\]]*"DeviceAdapterRegistry"[^\]]*\]\)/,
  );

  const start = schema.indexOf("model DeviceAdapterRegistry {");
  assert.ok(start >= 0, "DeviceAdapterRegistry model must exist");
  const end = schema.indexOf("\n}", start);
  const model = schema.slice(start, end);
  assert.doesNotMatch(model, /\borganizationId\b/);
});
