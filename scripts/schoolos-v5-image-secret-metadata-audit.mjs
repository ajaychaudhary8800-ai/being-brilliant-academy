#!/usr/bin/env node
/**
 * SchoolOS V5 #293 — read-only OCI config + Docker history credentials guard.
 * Emits only status codes and sensitive VARIABLE NAMES, never values,
 * image tags, raw history, labels, object metadata, registries or paths.
 * METADATA ONLY: does not scan image layers, build-cache or registry access.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const MARKERS = Object.freeze([
  "DATABASE_URL", "POSTGRES_PASSWORD", "REDIS_PASSWORD",
  "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET",
  "COMMERCIAL_DOCUMENT_ENCRYPTION_KEY",
  "PAYMENT_CREDENTIAL_ENCRYPTION_KEY",
  "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET",
  "LIVEKIT_API_SECRET", "LIVEKIT_RECORDING_S3_SECRET_ACCESS_KEY",
  "AWS_SECRET_ACCESS_KEY", "BACKUP_AWS_SECRET_ACCESS_KEY",
  "SMTP_PASSWORD", "AI_API_KEY", "TWILIO_AUTH_TOKEN",
  "WHATSAPP_ACCESS_TOKEN"
]);

const REFERENCE = /^[a-zA-Z0-9][a-zA-Z0-9._:/@-]{0,190}$/;
const IMAGE_SHA = /^sha256:[a-f0-9]{64}$/;

function secretAssignment(value, name) {
  // BuildKit RUN |57 NAME=value, image Config.Env, labels, etc.
  // All names are restricted to ASCII word + underscores.
  return new RegExp("(?:^|[^A-Za-z0-9_])" + name +
                    "\\s*(?:=|:)", "i").test(value);
}

export function analyzeImageMetadata(config, history) {
  if (!config || typeof config !== "object" ||
      !Array.isArray(config.Config?.Env) ||
      !Array.isArray(history) || history.length < 1 ||
      history.some(value => typeof value !== "string")) {
    return { verdict: "CHECK_REQUIRED_INVALID_CONFIG", names: [] };
  }
  const fields = [
    ...config.Config.Env.filter(value => typeof value === "string"),
    ...history,
    ...Object.entries(config.Config.Labels ?? {})
      .map(([name, value]) => name + "=" + String(value))
  ];
  const names = MARKERS.filter(name =>
    fields.some(value => secretAssignment(value, name)));
  return {
    verdict: names.length
      ? "REJECT_SECRET_IN_IMAGE_METADATA"
      : "PASS_METADATA_ONLY",
    names
  };
}

function docker(args) {
  const env = { ...process.env };
  for (const name of [
    "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY",
    "DOCKER_CERT_PATH", "DOCKER_API_VERSION"
  ]) delete env[name];
  const x = spawnSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 12 * 1024 * 1024,
    timeout: 120_000,
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
    env
  });
  if (x.error || x.status !== 0 || !x.stdout)
    throw new Error("DOCKER_METADATA_UNAVAILABLE");
  return x.stdout;
}

function inspectImage(image) {
  const configs = JSON.parse(docker([
    "--context", "default", "image", "inspect", image
  ]));
  if (!Array.isArray(configs) || configs.length !== 1 ||
      !IMAGE_SHA.test(configs[0].Id))
    throw new Error("IMAGE_INSPECT_UNTRUSTED");
  const historyLines = docker([
    "--context", "default", "history", "--no-trunc",
    "--format", "{{json .CreatedBy}}", image
  ]).trim().split("\n");
  if (historyLines.length < 2 || historyLines.length > 2048)
    throw new Error("IMAGE_HISTORY_INVALID");
  const history = historyLines.map(line => JSON.parse(line.trim()));
  return analyzeImageMetadata(configs[0], history);
}

export function main(args) {
  if (!args.length || args.length > 8 ||
      args.some(x => !REFERENCE.test(x))) {
    process.stdout.write("IMAGE_SECRET_METADATA_AUDIT=CHECK_REQUIRED_INPUT\n");
    return 2;
  }
  let failed = false;
  for (const ref of args) {
    let result;
    try {
      result = inspectImage(ref);
    } catch {
      result = { verdict: "CHECK_REQUIRED_INSPECTION", names: [] };
    }
    if (result.verdict !== "PASS_METADATA_ONLY") failed = true;
    process.stdout.write("IMAGE_SECRET_METADATA_AUDIT=" + result.verdict + "\n");
    if (result.names.length)
      process.stdout.write("EXPOSED_KEY_NAMES=" + result.names.join(",") + "\n");
  }
  process.stdout.write("IMAGE_LAYER_CONTENT_AUDIT=NOT_EXECUTED\n");
  process.stdout.write("SOURCE_BUILD_SIGNATURE=NOT_ATTESTED\n");
  process.stdout.write("STAGING_AND_PRODUCTION_CHANGED=NO\n");
  process.stdout.write("COMMERCIAL_GO=HOLD\n");
  return failed ? 2 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) ===
    fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
