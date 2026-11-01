import assert from "node:assert/strict";
import test from "node:test";
import { analyzeImageMetadata, main } from "./schoolos-v5-image-secret-metadata-audit.mjs";

const clean = () => ({
  Id: "sha256:" + "a".repeat(64),
  Config: {
    Env: ["NODE_ENV=production", "PORT=4000", "PATH=/bin:/usr/bin"],
    Labels: {"org.opencontainers.image.revision": "c".repeat(40)}
  }
});
const layers = ["RUN /bin/sh -c apk add --no-cache curl", "ENV NODE_ENV=production"];

test("safe metadata is PASS_METADATA_ONLY but explicitly not a layer audit", () => {
  assert.deepEqual(analyzeImageMetadata(clean(), layers), {
    verdict: "PASS_METADATA_ONLY", names: []
  });
});

test("detect Docker BuildKit injected Postgres and Redis build args by NAMES only", () => {
  const values = [
    "RUN |57 POSTGRES_PASSWORD=sensitive-password DATABASE_URL=postgresql://admin:sensitive-password@host/db REDIS_PASSWORD=sensitive-redis /bin/sh -c pnpm build",
  ];
  const result = analyzeImageMetadata(clean(), values);
  assert.equal(result.verdict, "REJECT_SECRET_IN_IMAGE_METADATA");
  assert.deepEqual(result.names, ["DATABASE_URL", "POSTGRES_PASSWORD", "REDIS_PASSWORD"]);
  assert.doesNotMatch(JSON.stringify(result), /sensitive-password|sensitive-redis/);
});

test("detect Vault, provider and SMTP secrets in history, labels and Env", () => {
  const config = clean();
  config.Config.Env.push("COMMERCIAL_DOCUMENT_ENCRYPTION_KEY=hidden-value");
  config.Config.Labels["audit.data"] = "SMTP_PASSWORD=hidden-mail";
  const r = analyzeImageMetadata(config, ["RUN |5 RAZORPAY_KEY_SECRET=hidden-pay echo skipped"]);
  assert.deepEqual(r.names, [
    "COMMERCIAL_DOCUMENT_ENCRYPTION_KEY", "RAZORPAY_KEY_SECRET", "SMTP_PASSWORD",
  ]);
  assert.doesNotMatch(JSON.stringify(r), /hidden-value|hidden-mail|hidden-pay/);
});

test("fail closed on malformed payloads or missing history", () => {
  for (const arg of [null, {}, {Config: {Env: null}}, {Config: {Env: []}}]) {
    assert.equal(analyzeImageMetadata(arg, []).verdict, "CHECK_REQUIRED_INVALID_CONFIG");
  }
  assert.equal(analyzeImageMetadata(clean(), [3]).verdict,
    "CHECK_REQUIRED_INVALID_CONFIG");
});

test("CLI invalid parameters fail closed without image name, logs or secrets", () => {
  const old = process.stdout.write;
  const lines = [];
  process.stdout.write = function (chunk) { lines.push(String(chunk)); return true; };
  try {
    assert.equal(main([]), 2);
    assert.equal(main(["some image with whitespace and secret"]), 2);
    assert.equal(lines.join(""),
      "IMAGE_SECRET_METADATA_AUDIT=CHECK_REQUIRED_INPUT\n" +
      "IMAGE_SECRET_METADATA_AUDIT=CHECK_REQUIRED_INPUT\n");
  } finally {
    process.stdout.write = old;
  }
});
