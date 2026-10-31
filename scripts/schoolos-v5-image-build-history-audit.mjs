#!/usr/bin/env node
/** Read-only V5 image history exposure audit. NEVER print raw image history,
 * Config.Env, Docker stderr, or secret values. PASS is metadata-only, not GO. */
import { spawnSync } from "node:child_process";

const KEYS = [
  "POSTGRES_PASSWORD","REDIS_PASSWORD","DATABASE_URL","REDIS_URL",
  "JWT_ACCESS_SECRET","JWT_REFRESH_SECRET","AI_API_KEY","SMTP_PASSWORD",
  "RAZORPAY_KEY_SECRET","RAZORPAY_WEBHOOK_SECRET",
  "PAYMENT_CREDENTIAL_ENCRYPTION_KEY","COMMERCIAL_DOCUMENT_ENCRYPTION_KEY",
  "AWS_ACCESS_KEY_ID","AWS_SECRET_ACCESS_KEY",
  "BACKUP_AWS_ACCESS_KEY_ID","BACKUP_AWS_SECRET_ACCESS_KEY",
  "LIVEKIT_API_KEY","LIVEKIT_API_SECRET","LIVEKIT_RECORDING_S3_ACCESS_KEY_ID",
  "LIVEKIT_RECORDING_S3_SECRET_ACCESS_KEY","TWILIO_AUTH_TOKEN",
  "WHATSAPP_ACCESS_TOKEN","WEB_PUSH_PRIVATE_KEY"
];
export function sensitiveAssignments(commands) {
  const found = new Set();
  for (const cmd of commands ?? []) {
    if (typeof cmd !== "string") continue;
    for (const key of KEYS) {
      // ARG KEY without an assignment is not an embedded value.
      // All assignments are conservative vetoes, including placeholders.
      if (new RegExp("(?:^|[\\s;|])" + key + "\\s*=").test(cmd)) found.add(key);
    }
  }
  return [...found].sort();
}
export function reviewImage({image, id, role, sha, history}) {
  const failures = [];
  const expectedDir = role === "API" ? "/workspace/apps/api" : "/app";
  if (image?.Id !== id) failures.push("IMAGE_ID_MISMATCH");
  if (image?.Config?.WorkingDir !== expectedDir) failures.push("ROLE_MISMATCH");
  if (image?.Config?.Labels?.["org.opencontainers.image.revision"] !== sha)
    failures.push("REVISION_MISMATCH");
  // Compose project/service labels belong to *containers*, not images.
  // The calling inventory pins the image ID from a V5 service container
  // after validating its Compose project and service identity. Enforcing
  // container-only labels on immutable image Config.Labels causes false FAIL
  // for correctly built, clean images. Do not equate source revision OCI
  // labels with signed build provenance.
  if (!Array.isArray(history) || !history.length || history.some(s=>typeof s!=="string"))
    failures.push("UNREADABLE_HISTORY");
  const keys = sensitiveAssignments(history);
  if (keys.length) failures.push("SENSITIVE_BUILD_HISTORY_ASSIGNMENT");
  const bakedKeys = (image?.Config?.Env ?? []).filter(e=>typeof e==="string")
    .map(e=>e.split("=",1)[0]).filter(k=>KEYS.includes(k));
  if (bakedKeys.length) failures.push("SENSITIVE_IMAGE_CONFIG_ENV");
  return {role, status:failures.length?"FAIL":"PASS_METADATA_ONLY",
    reasons:[...new Set(failures)].sort(), sensitiveKeyNames:keys,
    imageEnvKeyNames:[...new Set(bakedKeys)].sort(), credentialsPrinted:false,
    layersInspected:false, signedProvenanceVerified:false, launchAuthorized:false};
}
/** Scan the other locally-built images; these need not carry the API/Web
 * revision label or role workdir. The pinned container Image ID identifies
 * their service, so missing standalone image build labels are not excused
 * as a proof of provenance. Do not print or hash credentials. */
export function reviewSupportingImage({image,id,role,history}) {
  const failures=[];
  if (!["NGINX","BACKUP"].includes(role)) failures.push("UNEXPECTED_SUPPORT_ROLE");
  if (image?.Id !== id) failures.push("SUPPORT_IMAGE_ID_MISMATCH");
  if (!Array.isArray(history) || !history.length ||
      history.some(x=>typeof x!=="string")) failures.push("UNREADABLE_HISTORY");
  const keys=sensitiveAssignments(history);
  if (keys.length) failures.push("SENSITIVE_BUILD_HISTORY_ASSIGNMENT");
  const bakedKeys=(image?.Config?.Env??[]).filter(e=>typeof e==="string")
    .map(e=>e.split("=",1)[0]).filter(k=>KEYS.includes(k));
  if (bakedKeys.length) failures.push("SENSITIVE_IMAGE_CONFIG_ENV");
  return {
    role, status:failures.length?"FAIL":"PASS_METADATA_ONLY",
    reasons:[...new Set(failures)].sort(),sensitiveKeyNames:keys,
    imageEnvKeyNames:[...new Set(bakedKeys)].sort(),credentialsPrinted:false,
    sourceImageProvenanceVerified:false,layersInspected:false,
    signedProvenanceVerified:false,launchAuthorized:false
  };
}

function docker(args) {
  const r=spawnSync("docker",args,{encoding:"utf8",timeout:20000,maxBuffer:16*1024*1024});
  if (r.error || r.status!==0) throw new Error("DOCKER_READ_FAILED");
  return r.stdout;
}
export function auditSupportingImage({id,role}) {
  if (!/^sha256:[a-f0-9]{64}$/.test(id??"") ||
      !["NGINX","BACKUP"].includes(role)) throw new Error("INVALID_SUPPORT_PIN");
  let image,history;
  try {
    const images=JSON.parse(docker(["image","inspect",id]));
    if (!Array.isArray(images) || images.length!==1) throw new Error("INVALID_SUPPORT_IMAGE");
    image=images[0];
    history=docker(["history","--no-trunc","--format","{{json .CreatedBy}}",id])
      .trim().split("\n").map(row=>JSON.parse(row));
  } catch { throw new Error("SUPPORT_IMAGE_METADATA_READ_FAILED"); }
  return reviewSupportingImage({image,id,role,history});
}

export function auditImage({id,role,sha}) {
  if (!/^sha256:[a-f0-9]{64}$/.test(id??"") || !/^[a-f0-9]{40}$/.test(sha??"")
      || !["API","WEB"].includes(role)) throw new Error("INVALID_PIN");
  let image, history;
  try {
    const images=JSON.parse(docker(["image","inspect",id]));
    if (!Array.isArray(images) || images.length!==1) throw new Error("INVALID_IMAGE");
    image=images[0];
    history=docker(["history","--no-trunc","--format","{{json .CreatedBy}}",id])
      .trim().split("\n").map(row=>JSON.parse(row));
  } catch { throw new Error("IMAGE_METADATA_READ_FAILED"); }
  return reviewImage({image,id,role,sha,history});
}
function main() {
  const args=Object.create(null);
  for (const raw of process.argv.slice(2)) {
    const m=/^--(api|web|source)=([^\s]+)$/.exec(raw);
    if (!m || Object.hasOwn(args,m[1])) throw new Error("INVALID_ARGUMENTS");
    args[m[1]]=m[2];
  }
  if (Object.keys(args).length!==3) throw new Error("INVALID_ARGUMENTS");
  const images=[
    auditImage({id:args.api,role:"API",sha:args.source}),
    auditImage({id:args.web,role:"WEB",sha:args.source})
  ];
  const status=images.every(i=>i.status==="PASS_METADATA_ONLY")
    ? "PASS_METADATA_ONLY" : "FAIL";
  console.log("SCHOOLOS_V5_IMAGE_BUILD_HISTORY_AUDIT "+JSON.stringify({
    status,images,credentialsPrinted:false,imagesChanged:false,
    registryProvenanceVerified:false,fullLayerSecretScanVerified:false,
    previousVersionRollbackVerified:false,commercialReleaseAuthorized:false
  }));
  if (status!=="PASS_METADATA_ONLY") process.exitCode=1;
}
if (process.argv[1]?.endsWith("schoolos-v5-image-build-history-audit.mjs")) {
  try {main();}
  catch {console.error("SCHOOLOS_V5_IMAGE_BUILD_HISTORY_AUDIT=CHECK_REQUIRED_NO_VALUES_PRINTED");
    process.exitCode=1;}
}
