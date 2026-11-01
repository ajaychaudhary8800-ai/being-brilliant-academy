#!/usr/bin/env node
// Restricted local-only AES-256-GCM/sha256 verification of ONE approved V5
// ciphertext. No plaintext, secret value, ciphertext or digest is logged.
// For actual recovery invoke only via the owner-local offline PostgreSQL runner.
// Never read a live staging secret, Docker env/history, R2 or provider credentials.
import crypto from "node:crypto";
import fs from "node:fs";
import process from "node:process";

const PREFIX = Buffer.from("CDV1", "ascii");
const MAX_FILE = 10 * 1024 * 1024;
const MAX_STDIN = 2 * MAX_FILE + 4096;

function sameHash(a, b) {
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyEnvelope(packed, expectedHex, expectedSize, material) {
  if (!(packed instanceof Buffer) || packed.length < 33 ||
      packed.length > MAX_FILE + 32 || !packed.subarray(0, 4).equals(PREFIX)) {
    return false;
  }
  if (!/^[a-f0-9]{64}$/.test(expectedHex) ||
      !Number.isInteger(expectedSize) || expectedSize < 1 ||
      expectedSize > MAX_FILE || expectedSize !== packed.length - 32 ||
      typeof material !== "string" || material.length < 32) {
    return false;
  }
  const key = crypto.createHash("sha256").update(material, "utf8").digest();
  let plaintext;
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm", key, packed.subarray(4, 16)
    );
    decipher.setAuthTag(packed.subarray(16, 32));
    plaintext = Buffer.concat([
      decipher.update(packed.subarray(32)), decipher.final()
    ]);
    const actual = crypto.createHash("sha256").update(plaintext).digest();
    const expected = Buffer.from(expectedHex, "hex");
    return plaintext.length === expectedSize && sameHash(actual, expected);
  } catch {
    return false;
  } finally {
    key.fill(0);
    if (plaintext) plaintext.fill(0);
  }
}

function syntheticSelfTest() {
  const material = crypto.randomBytes(40).toString("hex");
  const plaintext = Buffer.from("%PDF-1.7\nSYNTHETIC_V5_VAULT_ONLY\n");
  const key = crypto.createHash("sha256").update(material).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  // GCM auth tag must be retrieved AFTER final(); never rely on initial tag.
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope = Buffer.concat([PREFIX, iv, cipher.getAuthTag(), ct]);
  const digest = crypto.createHash("sha256").update(plaintext).digest("hex");
  const good = verifyEnvelope(envelope, digest, plaintext.length, material);
  const tampered = Buffer.from(envelope);
  tampered[tampered.length - 1] ^= 1;
  const tests = [
    good,
    !verifyEnvelope(tampered, digest, plaintext.length, material),
    !verifyEnvelope(envelope, digest, plaintext.length, material + "wrong"),
    !verifyEnvelope(envelope, "0".repeat(64), plaintext.length, material),
    !verifyEnvelope(envelope, digest, plaintext.length + 1, material),
    !verifyEnvelope(Buffer.from("ABCD"), digest, plaintext.length, material),
  ];
  key.fill(0);
  plaintext.fill(0);
  if (!tests.every(Boolean)) throw new Error("SYNTHETIC_CRYPTO_TEST_FAILED");
  console.log("VAULT_OFFLINE_CRYPTO_SYNTHETIC=PASS");
  console.log("VAULT_OFFLINE_TAMPER_AND_WRONG_KEY_VETO=PASS");
}

async function readBoundedStdin() {
  const blocks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > MAX_STDIN) throw new Error("PRIVATE_INPUT_TOO_LARGE");
    blocks.push(chunk);
  }
  return Buffer.concat(blocks).toString("utf8");
}

function escrowMaterial(file) {
  if (typeof file !== "string" || !file || file.includes("\0")) {
    throw new Error("INVALID_ESCROW_PATH");
  }
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 32 ||
      info.size > 512) {
    throw new Error("INVALID_ESCROW_FILE");
  }
  const bytes = fs.readFileSync(file);
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value = decoded.replace(/\r?\n$/, "");
    // Single exact UTF-8 secret; never parse a .env or alter surrounding
    // whitespace/quotes because application hashes original material verbatim.
    if (value.length < 32 || /[\r\n\0]/.test(value) ||
        value.startsWith("COMMERCIAL_DOCUMENT_ENCRYPTION_KEY=")) {
      throw new Error("ESCROW_FORMAT_UNACCEPTABLE");
    }
    return value;
  } finally {
    bytes.fill(0);
  }
}

async function verifyOwnerPrivateStdin() {
  if (process.platform !== "win32") throw new Error("OWNER_WINDOWS_REQUIRED");
  if (!process.stdin.isTTY) {
    const input = JSON.parse(await readBoundedStdin());
    const names = Object.keys(input).sort();
    if (JSON.stringify(names) !== JSON.stringify(
      ["cipherHex", "escrowKeyFile", "expectedSha256", "fileSize"].sort()
    )) {
      throw new Error("PRIVATE_INPUT_FIELDS_UNEXPECTED");
    }
    if (typeof input.cipherHex !== "string" ||
        !/^[a-fA-F0-9]+$/.test(input.cipherHex) ||
        input.cipherHex.length > 2 * (MAX_FILE + 32)) {
      throw new Error("CIPHERTEXT_INVALID");
    }
    const material = escrowMaterial(input.escrowKeyFile);
    const ciphertext = Buffer.from(input.cipherHex, "hex");
    try {
      if (!verifyEnvelope(ciphertext, input.expectedSha256,
                          input.fileSize, material)) {
        throw new Error("AUTHENTICATED_DECRYPTION_OR_DIGEST_FAILED");
      }
      console.log("VAULT_OFFLINE_GCM_TAG_AND_CONTENT_DIGEST=PASS");
      console.log("VAULT_PLAINTEXT_AND_KEY_PRINTED=NO");
    } finally {
      ciphertext.fill(0);
    }
  } else {
    throw new Error("PIPED_PRIVATE_INPUT_REQUIRED");
  }
}

try {
  if (process.argv.length !== 3) throw new Error("INVALID_MODE");
  if (process.argv[2] === "--synthetic-self-test") {
    syntheticSelfTest();
  } else if (process.argv[2] === "--owner-private-stdin") {
    await verifyOwnerPrivateStdin();
  } else {
    throw new Error("INVALID_MODE");
  }
} catch {
  // No exception messages or file paths: some include secrets or identifiers.
  console.log("VAULT_OFFLINE_GCM_TAG_AND_CONTENT_DIGEST=CHECK_REQUIRED");
  process.exitCode = 2;
}
