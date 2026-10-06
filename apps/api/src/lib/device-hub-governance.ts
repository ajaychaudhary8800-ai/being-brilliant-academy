import crypto from "node:crypto";

export function generateEdgeAgentToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashEdgeAgentToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function verifyEdgeAgentToken(token: string, expectedHash: string | null | undefined) {
  if (!token || !expectedHash || !/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
  const actual = Buffer.from(hashEdgeAgentToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export type DeviceSignatureResult =
  | { ok: true; timestamp: Date; ageMs: number }
  | { ok: false; code: "SIGNATURE_REQUIRED" | "SIGNATURE_TIMESTAMP_INVALID" | "SIGNATURE_TIMESTAMP_OUT_OF_WINDOW" | "SIGNATURE_INVALID" | "SIGNING_KEY_INVALID" };

export function verifyDeviceEventSignature(input: {
  sourceHash: string;
  publicKey: string | null | undefined;
  timestampHeader: string | null | undefined;
  signatureHeader: string | null | undefined;
  now?: Date;
  maxSkewMs?: number;
}): DeviceSignatureResult {
  if (!input.timestampHeader || !input.signatureHeader) return { ok: false, code: "SIGNATURE_REQUIRED" };
  const raw = input.timestampHeader.trim();
  const numeric = /^\d+$/.test(raw) ? Number(raw) : NaN;
  const timestamp = Number.isFinite(numeric)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(raw);
  if (!Number.isFinite(timestamp.getTime())) return { ok: false, code: "SIGNATURE_TIMESTAMP_INVALID" };

  const now = input.now ?? new Date();
  const ageMs = Math.abs(now.getTime() - timestamp.getTime());
  if (ageMs > (input.maxSkewMs ?? 5 * 60_000)) return { ok: false, code: "SIGNATURE_TIMESTAMP_OUT_OF_WINDOW" };
  if (!input.publicKey) return { ok: false, code: "SIGNING_KEY_INVALID" };

  let signature: Buffer;
  try {
    const normalized = input.signatureHeader.trim().replace(/-/g, "+").replace(/_/g, "/");
    signature = Buffer.from(normalized, "base64");
    if (!signature.length) return { ok: false, code: "SIGNATURE_INVALID" };
  } catch {
    return { ok: false, code: "SIGNATURE_INVALID" };
  }

  try {
    const key = crypto.createPublicKey(input.publicKey);
    if (key.asymmetricKeyType !== "ed25519") return { ok: false, code: "SIGNING_KEY_INVALID" };
    const message = Buffer.from(`${raw}.${input.sourceHash}`, "utf8");
    const ok = crypto.verify(null, message, key, signature);
    return ok ? { ok: true, timestamp, ageMs } : { ok: false, code: "SIGNATURE_INVALID" };
  } catch {
    return { ok: false, code: "SIGNING_KEY_INVALID" };
  }
}

export function retryBackoffMs(attempts: number, baseMs = 5_000, maxMs = 30 * 60_000) {
  const safeAttempt = Math.max(0, Math.min(20, Math.floor(attempts)));
  return Math.min(maxMs, baseMs * 2 ** safeAttempt);
}

export function nextRetryState(input: {
  attempts: number;
  maxAttempts: number;
  now?: Date;
  baseMs?: number;
}) {
  const attempts = Math.max(0, Math.floor(input.attempts)) + 1;
  if (attempts >= input.maxAttempts) {
    return { attempts, status: "DEAD_LETTER" as const, nextAttemptAt: null };
  }
  const now = input.now ?? new Date();
  return {
    attempts,
    status: "QUEUED" as const,
    nextAttemptAt: new Date(now.getTime() + retryBackoffMs(attempts - 1, input.baseMs)),
  };
}

export function connectorHealth(input: {
  status: string;
  lastSuccessAt?: Date | null;
  lastErrorAt?: Date | null;
  consecutiveFailures?: number | null;
  latencyMs?: number | null;
  now?: Date;
  staleAfterMs?: number;
}) {
  const now = input.now ?? new Date();
  const staleAfterMs = input.staleAfterMs ?? 15 * 60_000;
  const stale = !input.lastSuccessAt || now.getTime() - input.lastSuccessAt.getTime() > staleAfterMs;
  return {
    healthy: input.status === "ACTIVE" && !stale && (input.consecutiveFailures ?? 0) === 0,
    stale,
    consecutiveFailures: input.consecutiveFailures ?? 0,
    latencyMs: input.latencyMs ?? null,
    lastSuccessAt: input.lastSuccessAt ?? null,
    lastErrorAt: input.lastErrorAt ?? null,
  };
}
