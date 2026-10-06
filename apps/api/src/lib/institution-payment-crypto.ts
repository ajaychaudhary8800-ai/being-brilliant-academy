import crypto from "node:crypto";
import { env } from "../config.js";
import { AppError } from "./http.js";

const VERSION = "v1";

function key() {
  const material = env.PAYMENT_CREDENTIAL_ENCRYPTION_KEY;
  if (!material) {
    throw new AppError(
      503,
      "PAYMENT_ENCRYPTION_NOT_CONFIGURED",
      "Institution payment credential encryption is not configured",
    );
  }
  return crypto.createHash("sha256").update(material, "utf8").digest();
}

export function institutionPaymentEncryptionReady() {
  return Boolean(env.PAYMENT_CREDENTIAL_ENCRYPTION_KEY);
}

export function encryptInstitutionPaymentSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptInstitutionPaymentSecret(value: string) {
  const [version, ivText, tagText, encryptedText] = value.split(".");
  if (version !== VERSION || !ivText || !tagText || !encryptedText) {
    throw new AppError(500, "PAYMENT_CREDENTIAL_INVALID", "Stored payment credential cannot be decrypted");
  }
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new AppError(500, "PAYMENT_CREDENTIAL_INVALID", "Stored payment credential cannot be decrypted");
  }
}
