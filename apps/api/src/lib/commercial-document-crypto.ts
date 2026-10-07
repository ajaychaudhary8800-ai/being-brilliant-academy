import crypto from "node:crypto";
import { env } from "../config.js";
import { AppError } from "./http.js";

const PREFIX = Buffer.from("CDV1", "ascii");
const IV_BYTES = 12;
const TAG_BYTES = 16;

function key() {
  const material = env.COMMERCIAL_DOCUMENT_ENCRYPTION_KEY;
  if (!material) throw new AppError(503, "COMMERCIAL_DOCUMENT_ENCRYPTION_NOT_CONFIGURED", "Configure COMMERCIAL_DOCUMENT_ENCRYPTION_KEY before using the Commercial Document Vault");
  return crypto.createHash("sha256").update(material, "utf8").digest();
}

export function commercialDocumentEncryptionReady() {
  return Boolean(env.COMMERCIAL_DOCUMENT_ENCRYPTION_KEY);
}

export function encryptCommercialDocument(bytes: Buffer) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([PREFIX, iv, tag, encrypted]);
}

export function decryptCommercialDocument(payload: Uint8Array) {
  const packed = Buffer.from(payload);
  const minimum = PREFIX.length + IV_BYTES + TAG_BYTES + 1;
  if (packed.length < minimum || !packed.subarray(0, PREFIX.length).equals(PREFIX)) {
    throw new AppError(500, "COMMERCIAL_DOCUMENT_CIPHERTEXT_INVALID", "Stored commercial document encryption payload is invalid");
  }
  const ivStart = PREFIX.length;
  const tagStart = ivStart + IV_BYTES;
  const dataStart = tagStart + TAG_BYTES;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), packed.subarray(ivStart, tagStart));
    decipher.setAuthTag(packed.subarray(tagStart, dataStart));
    return Buffer.concat([decipher.update(packed.subarray(dataStart)), decipher.final()]);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(500, "COMMERCIAL_DOCUMENT_DECRYPTION_FAILED", "Stored commercial document could not be decrypted");
  }
}
