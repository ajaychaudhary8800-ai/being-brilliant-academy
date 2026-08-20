import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../config.js";

const s3 = env.STORAGE_DRIVER === "s3" ? new S3Client({
  region: env.AWS_REGION!, endpoint: env.AWS_S3_ENDPOINT,
  forcePathStyle: Boolean(env.AWS_S3_ENDPOINT),
  credentials: env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY ? { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY } : undefined,
}) : null;
function safeKey(key: string) {
  const normalized = key.replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (!normalized || normalized.startsWith("/") || parts.some((part) => !part || part === "." || part === "..")) throw new Error("Invalid storage key");
  return normalized;
}

function localTarget(key: string) {
  const root = resolve(env.LOCAL_STORAGE_PATH);
  const target = resolve(root, key);
  if (target === root || !target.startsWith(`${root}${sep}`)) throw new Error("Invalid storage key");
  return target;
}

export async function putObject(key: string, body: Buffer | NodeJS.ReadableStream, contentType?: string) {
  const normalized = safeKey(key);
  if (s3) { await s3.send(new PutObjectCommand({ Bucket: env.AWS_S3_BUCKET!, Key: normalized, Body: body as Buffer, ContentType: contentType })); return normalized; }
  const target = localTarget(normalized); await mkdir(dirname(target), { recursive: true });
  await pipeline(body instanceof Buffer ? ReadableFromBuffer(body) : body, createWriteStream(target)); return normalized;
}
function ReadableFromBuffer(buffer: Buffer) { return createReadStreamFromIterable([buffer]); }
import { Readable } from "node:stream";
const createReadStreamFromIterable = (chunks: Buffer[]) => Readable.from(chunks);
export async function getObject(key: string) {
  const normalized = safeKey(key);
  if (s3) { const result = await s3.send(new GetObjectCommand({ Bucket: env.AWS_S3_BUCKET!, Key: normalized })); return result.Body; }
  const target = localTarget(normalized); await stat(target);
  return createReadStream(target);
}

export async function deleteObject(key: string) {
  const normalized = safeKey(key);
  if (s3) { await s3.send(new DeleteObjectCommand({ Bucket: env.AWS_S3_BUCKET!, Key: normalized })); return; }
  await rm(localTarget(normalized), { force: true });
}
