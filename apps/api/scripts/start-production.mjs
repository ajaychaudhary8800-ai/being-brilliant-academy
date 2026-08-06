import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const prismaCli = resolve(process.cwd(), "node_modules/prisma/build/index.js");
const migration = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
  env: process.env,
  stdio: "inherit",
});

if (migration.status !== 0) process.exit(migration.status ?? 1);
await import("../dist/src/server.js");
