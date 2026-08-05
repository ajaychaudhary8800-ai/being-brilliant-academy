import { config } from "dotenv";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), "../../.env") });
const cli = resolve(process.cwd(), "node_modules/prisma/build/index.js");
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
