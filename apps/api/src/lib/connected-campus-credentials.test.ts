import assert from "node:assert/strict";
import test from "node:test";
import {
  generatePickupCredentials,
  generateVisitorBadgeCode,
  hashPickupQrToken,
  verifyPickupOtp,
  verifyPickupQrToken,
} from "./connected-campus-credentials.js";

test("pickup credentials are high-entropy/one-time-display values with stable hashes", () => {
  const a = generatePickupCredentials();
  const b = generatePickupCredentials();
  assert.notEqual(a.qrToken, b.qrToken);
  assert.notEqual(a.otp, b.otp);
  assert.equal(a.qrTokenHash.length, 64);
  assert.equal(a.otpHash.length, 64);
  assert.notEqual(a.qrToken, a.qrTokenHash);
  assert.notEqual(a.otp, a.otpHash);
});

test("pickup QR verification uses the stored digest", () => {
  const c = generatePickupCredentials();
  assert.equal(hashPickupQrToken(c.qrToken), c.qrTokenHash);
  assert.equal(verifyPickupQrToken(c.qrToken, c.qrTokenHash), true);
  assert.equal(verifyPickupQrToken(c.qrToken + "x", c.qrTokenHash), false);
});

test("pickup OTP verifies only six-digit values with keyed digest", () => {
  const c = generatePickupCredentials();
  assert.equal(/^\d{6}$/.test(c.otp), true);
  assert.equal(verifyPickupOtp(c.otp, c.otpHash), true);
  assert.equal(verifyPickupOtp("000000" === c.otp ? "000001" : "000000", c.otpHash), false);
  assert.equal(verifyPickupOtp("12345", c.otpHash), false);
});

test("visitor badges are opaque and non-sequential", () => {
  const a = generateVisitorBadgeCode();
  const b = generateVisitorBadgeCode();
  assert.match(a, /^VIS-[A-F0-9]{12}$/);
  assert.notEqual(a, b);
});
