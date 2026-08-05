import { Redis } from "ioredis";
import { env } from "../config.js";
import { logger } from "./logger.js";

export const redis = env.REDIS_URL ? new Redis(env.REDIS_URL, {
  lazyConnect: true,
  enableOfflineQueue: true,
  maxRetriesPerRequest: 1,
  retryStrategy: (attempt: number) => Math.min(attempt * 250, 5_000),
}) : null;

redis?.on("error", (error: Error) => logger.warn({ err: error }, "Redis connection error"));
export async function ensureRedis() {
  if (!redis) return false;
  if (redis.status === "wait" || redis.status === "end") await redis.connect();
  return (await redis.ping()) === "PONG";
}
export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!redis) return null;
  try { const value = await redis.get(key); return value ? JSON.parse(value) as T : null; } catch { return null; }
}
export async function cacheSet(key: string, value: unknown, ttlSeconds = 300) {
  if (!redis) return false;
  try { await redis.set(key, JSON.stringify(value), "EX", ttlSeconds); return true; } catch { return false; }
}
export async function enqueue(queue: string, payload: unknown) {
  if (!redis) throw new Error("Redis is not configured");
  await ensureRedis();
  return redis.lpush(`queue:${queue}`, JSON.stringify({ payload, queuedAt: new Date().toISOString() }));
}
