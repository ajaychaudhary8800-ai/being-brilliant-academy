import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const unsafeDatabaseMessage = "TEST_DATABASE_URL must be a local PostgreSQL URL whose database name clearly identifies a test database";

export function assertSafeTestDatabaseUrl(configured) {
  let parsed;
  try { parsed = new URL(configured); } catch { parsed = null; }
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  const databaseName = parsed?.pathname.replace(/^\//, "") ?? "";
  if (!parsed || !["postgres:", "postgresql:"].includes(parsed.protocol) || !localHosts.has(parsed.hostname) || !/(^|[_-])(test|integration)([_-]|$)/i.test(databaseName)) {
    throw new Error(unsafeDatabaseMessage);
  }
  return configured;
}

export function pnpmSpawnSpec(args, { platform = process.platform, execPath = process.execPath, npmExecPath = process.env.npm_execpath } = {}) {
  if (npmExecPath) return { command: execPath, args: [npmExecPath, ...args] };
  if (platform === "win32") throw new Error("npm_execpath is unavailable on Windows; invoke this runner through pnpm so its JavaScript entrypoint can be used safely");
  return { command: "pnpm", args };
}

function runPnpm(args, env) {
  const { command, args: commandArgs } = pnpmSpawnSpec(args, { npmExecPath: process.env.npm_execpath });
  const result = spawnSync(command, commandArgs, { stdio: "inherit", env, shell: false });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

export function main() {
  const configured = process.env.TEST_DATABASE_URL;
  if (!configured) {
    console.error("TEST_DATABASE_URL is required; refusing to run integration tests");
    return 2;
  }
  try { assertSafeTestDatabaseUrl(configured); } catch (error) {
    console.error(error instanceof Error ? error.message : unsafeDatabaseMessage);
    return 2;
  }

  const env = { ...process.env, NODE_ENV: "test", RUN_POSTGRES_INTEGRATION: "1", DATABASE_URL: configured };
  const migrationStatus = runPnpm(["--filter", "@bba/api", "exec", "prisma", "migrate", "deploy"], env);
  if (migrationStatus !== 0) return migrationStatus;

  const integrationDir = fileURLToPath(new URL("../src/integration/", import.meta.url));
  const integrationFiles = readdirSync(integrationDir)
    .filter(file => file.endsWith(".integration.test.ts"))
    .map(file => `src/integration/${file}`);
  if (!integrationFiles.length) {
    console.error("No PostgreSQL integration tests were found; refusing to report a green run");
    return 2;
  }
  return runPnpm(["--filter", "@bba/api", "exec", "tsx", "--test", ...integrationFiles], env);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) process.exitCode = main();
