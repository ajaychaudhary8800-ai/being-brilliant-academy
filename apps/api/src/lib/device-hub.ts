import crypto from "node:crypto";
import { z } from "zod";

export const connectedDeviceEventEnvelopeSchema = z.object({
  externalEventId: z.string().trim().min(1).max(180).optional(),
  eventType: z.string().trim().min(1).max(120),
  occurredAt: z.coerce.date(),
  payload: z.record(z.string(), z.unknown()),
  heartbeat: z.boolean().default(false),
});

export type ConnectedDeviceEventEnvelope = z.infer<typeof connectedDeviceEventEnvelopeSchema>;

export type NormalizedConnectedDeviceEvent = {
  eventType: string;
  occurredAt: Date;
  category: "HEARTBEAT" | "IDENTITY" | "LOCATION" | "ACCESS" | "VIDEO" | "SENSOR" | "GENERIC";
  subjectExternalId: string | null;
  latitude: number | null;
  longitude: number | null;
  speedKph: number | null;
  direction: "IN" | "OUT" | null;
  reading: number | null;
  unit: string | null;
  metadata: Record<string, unknown>;
};

function stableValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return JSON.stringify(String(value));
    return JSON.stringify(value);
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item)}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

export function connectedDeviceSourceHash(input: {
  externalEventId?: string | null;
  eventType: string;
  occurredAt: Date;
  payload: unknown;
}) {
  return crypto.createHash("sha256")
    .update(input.externalEventId?.trim() || "")
    .update("\n")
    .update(input.eventType.trim().toLocaleUpperCase("en"))
    .update("\n")
    .update(input.occurredAt.toISOString())
    .update("\n")
    .update(stableValue(input.payload))
    .digest("hex");
}

export function generateConnectedDeviceIngestToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashConnectedDeviceIngestToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function verifyConnectedDeviceIngestToken(token: string, expectedHash: string | null | undefined) {
  if (!token || !expectedHash) return false;
  const actual = Buffer.from(hashConnectedDeviceIngestToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function directionValue(value: unknown): "IN" | "OUT" | null {
  const text = stringValue(value)?.toLocaleUpperCase("en");
  return text === "IN" || text === "ENTRY" || text === "CHECKIN" || text === "CHECK_IN" ? "IN"
    : text === "OUT" || text === "EXIT" || text === "CHECKOUT" || text === "CHECK_OUT" ? "OUT"
    : null;
}
function eventCategory(eventType: string, heartbeat: boolean) {
  if (heartbeat) return "HEARTBEAT" as const;
  const type = eventType.toLocaleUpperCase("en");
  if (/GPS|LOCATION|POSITION|GEOFENCE|SPEED/.test(type)) return "LOCATION" as const;
  if (/BIOMETRIC|RFID|CARD|FACE|FINGER|ATTENDANCE/.test(type)) return "IDENTITY" as const;
  if (/ACCESS|GATE|DOOR|ENTRY|EXIT/.test(type)) return "ACCESS" as const;
  if (/CAMERA|VIDEO|MOTION|NVR|DVR/.test(type)) return "VIDEO" as const;
  if (/SENSOR|TEMPERATURE|HUMIDITY|AIR|SMOKE|NOISE/.test(type)) return "SENSOR" as const;
  return "GENERIC" as const;
}

export function normalizeConnectedDeviceEvent(envelope: ConnectedDeviceEventEnvelope): NormalizedConnectedDeviceEvent {
  const p = envelope.payload;
  const latitude = numberValue(p.latitude ?? p.lat);
  const longitude = numberValue(p.longitude ?? p.lng ?? p.lon);
  if (latitude !== null && (latitude < -90 || latitude > 90)) throw new Error("Device latitude is outside valid range");
  if (longitude !== null && (longitude < -180 || longitude > 180)) throw new Error("Device longitude is outside valid range");
  const speedKph = numberValue(p.speedKph ?? p.speed ?? p.velocity);
  if (speedKph !== null && speedKph < 0) throw new Error("Device speed cannot be negative");

  return {
    eventType: envelope.eventType.trim().toLocaleUpperCase("en"),
    occurredAt: envelope.occurredAt,
    category: eventCategory(envelope.eventType, envelope.heartbeat),
    subjectExternalId: stringValue(p.subjectExternalId ?? p.personId ?? p.userId ?? p.cardId ?? p.rfid ?? p.biometricCode),
    latitude,
    longitude,
    speedKph,
    direction: directionValue(p.direction ?? p.action ?? p.event),
    reading: numberValue(p.reading ?? p.value),
    unit: stringValue(p.unit),
    metadata: Object.fromEntries(
      Object.entries(p).filter(([key]) => ![
        "latitude","lat","longitude","lng","lon","speedKph","speed","velocity",
        "subjectExternalId","personId","userId","cardId","rfid","biometricCode",
        "direction","action","event","reading","value","unit",
      ].includes(key)),
    ),
  };
}

export function connectedDeviceHealth(input: {
  status: string;
  lastHeartbeatAt?: Date | null;
  lastSeenAt?: Date | null;
  now?: Date;
  staleAfterSeconds?: number;
}) {
  const now = input.now ?? new Date();
  const staleAfterSeconds = input.staleAfterSeconds ?? 300;
  const last = input.lastHeartbeatAt ?? input.lastSeenAt ?? null;
  const stale = !last || now.getTime() - last.getTime() > staleAfterSeconds * 1000;
  return {
    online: input.status === "ACTIVE" && !stale,
    stale,
    lastSeenAt: last,
    ageSeconds: last ? Math.max(0, Math.floor((now.getTime() - last.getTime()) / 1000)) : null,
  };
}
