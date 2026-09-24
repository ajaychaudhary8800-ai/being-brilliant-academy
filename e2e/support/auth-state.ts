import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { BrowserContext } from "@playwright/test";

const ACCESS_KEY = "bba.accessToken";
const REFRESH_KEY = "bba.refreshToken";

type StoredState = {
  cookies?: unknown[];
  origins?: Array<{
    origin: string;
    localStorage?: Array<{ name: string; value: string }>;
  }>;
};

const statePath = (role: string) =>
  resolve(process.env.QA_AUTH_STATE_DIR ?? "test-results/qa-auth", `${role}.json`);

function readState(role: string): StoredState {
  return JSON.parse(readFileSync(statePath(role), "utf8")) as StoredState;
}

function writeState(role: string, state: StoredState) {
  const file = statePath(role);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
}

export function storedAuthTokens(role: string) {
  const state = readState(role);
  for (const origin of state.origins ?? []) {
    const local = new Map((origin.localStorage ?? []).map(item => [item.name, item.value]));
    const accessToken = local.get(ACCESS_KEY);
    const refreshToken = local.get(REFRESH_KEY);
    if (accessToken && refreshToken) return { accessToken, refreshToken };
  }
  throw new Error(`Saved QA auth state for ${role} is missing access or refresh token`);
}

export function updateStoredAuthTokens(role: string, accessToken: string, refreshToken: string) {
  const state = readState(role);
  const origin = state.origins?.find(item => (item.localStorage ?? []).some(entry => entry.name === ACCESS_KEY || entry.name === REFRESH_KEY));
  if (!origin) throw new Error(`Saved QA auth state for ${role} has no application origin`);
  const local = new Map((origin.localStorage ?? []).map(item => [item.name, item.value]));
  local.set(ACCESS_KEY, accessToken);
  local.set(REFRESH_KEY, refreshToken);
  origin.localStorage = Array.from(local, ([name, value]) => ({ name, value }));
  writeState(role, state);
}

export async function saveContextAuthState(context: BrowserContext, role: string) {
  const state = await context.storageState();
  writeState(role, state);
}
