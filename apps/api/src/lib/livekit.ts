import jwt from "jsonwebtoken";
import { env } from "../config.js";
import { AppError } from "./http.js";

type VideoGrant = {
  room?: string;
  roomJoin?: boolean;
  roomAdmin?: boolean;
  roomRecord?: boolean;
  roomCreate?: boolean;
  roomList?: boolean;
  canPublish?: boolean;
  canSubscribe?: boolean;
  canPublishData?: boolean;
  canPublishSources?: string[];
  canUpdateOwnMetadata?: boolean;
};

export function livekitConfigured() {
  return Boolean(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET);
}

function assertConfigured() {
  if (!livekitConfigured()) {
    throw new AppError(503, "LIVE_CLASS_NOT_CONFIGURED", "Native live classroom is not configured yet");
  }
}

function livekitHttpUrl() {
  assertConfigured();
  const value = env.LIVEKIT_URL!;
  if (value.startsWith("wss://")) return `https://${value.slice(6).replace(/\/$/, "")}`;
  if (value.startsWith("ws://")) return `http://${value.slice(5).replace(/\/$/, "")}`;
  return value.replace(/\/$/, "");
}

export function livekitClientUrl() {
  assertConfigured();
  const value = env.LIVEKIT_URL!;
  if (value.startsWith("https://")) return `wss://${value.slice(8).replace(/\/$/, "")}`;
  if (value.startsWith("http://")) return `ws://${value.slice(7).replace(/\/$/, "")}`;
  return value.replace(/\/$/, "");
}

export function createLiveKitToken(input: {
  identity: string;
  name?: string;
  room?: string;
  grant: VideoGrant;
  role?: string;
  ttlSeconds?: number;
}) {
  assertConfigured();
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    iss: env.LIVEKIT_API_KEY,
    sub: input.identity,
    nbf: now - 5,
    exp: now + (input.ttlSeconds ?? 7200),
    video: input.grant,
  };
  if (input.name) payload.name = input.name;
  if (input.role) payload.attributes = { role: input.role };
  return jwt.sign(payload, env.LIVEKIT_API_SECRET!, { algorithm: "HS256", noTimestamp: true });
}

export async function livekitRoomService(method: string, body: Record<string, unknown>, room: string) {
  const token = createLiveKitToken({
    identity: "bba-server",
    room,
    grant: { roomAdmin: true, room },
    ttlSeconds: 300,
  });
  const response = await fetch(`${livekitHttpUrl()}/twirp/livekit.RoomService/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AppError(502, "LIVE_CLASS_PROVIDER_ERROR", value?.msg ?? value?.message ?? "Live classroom provider request failed");
  }
  return value;
}

export async function livekitEgress(method: string, body: Record<string, unknown>) {
  const token = createLiveKitToken({
    identity: "bba-recorder",
    grant: { roomRecord: true },
    ttlSeconds: 300,
  });
  const response = await fetch(`${livekitHttpUrl()}/twirp/livekit.Egress/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AppError(502, "LIVE_CLASS_RECORDING_ERROR", value?.msg ?? value?.message ?? "Unable to control live-class recording");
  }
  return value;
}
