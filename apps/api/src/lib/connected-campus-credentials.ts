import crypto from "node:crypto";
import { env } from "../config.js";

const OTP_DOMAIN = "being-brilliant:pickup-otp:v1:";

function digest(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function otpDigest(value: string) {
  return crypto.createHmac("sha256", env.JWT_REFRESH_SECRET).update(OTP_DOMAIN).update(value).digest("hex");
}

function timingSafeHex(actual: string, expected: string | null | undefined) {
  if (!expected || !/^[a-f0-9]{64}$/i.test(expected)) return false;
  const a = Buffer.from(actual, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function generatePickupCredentials() {
  const qrToken = crypto.randomBytes(32).toString("base64url");
  const otp = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  return {
    qrToken,
    otp,
    qrTokenHash: digest(qrToken),
    otpHash: otpDigest(otp),
  };
}

export function hashPickupQrToken(token: string) {
  return digest(token);
}

export function verifyPickupQrToken(token: string, expectedHash: string | null | undefined) {
  if (!token || token.length < 20) return false;
  return timingSafeHex(hashPickupQrToken(token), expectedHash);
}

export function verifyPickupOtp(otp: string, expectedHash: string | null | undefined) {
  if (!/^\d{6}$/.test(otp)) return false;
  return timingSafeHex(otpDigest(otp), expectedHash);
}

export function generateVisitorBadgeCode() {
  return `VIS-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
}
