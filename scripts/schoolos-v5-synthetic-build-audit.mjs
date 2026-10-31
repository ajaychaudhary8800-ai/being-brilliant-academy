#!/usr/bin/env node
/** CI-only synthetic V5 image build audit. Never logs image config, Docker
 * history, Docker stderr, environment variable values, or secret content.
 * Requires a disposable CI runner; does not deploy or run containers. */
import { spawnSync } from "node:child_process";
import { sensitiveAssignments, reviewSupportingImage } from "./schoolos-v5-image-build-history-audit.mjs";

const KEYS = ["POSTGRES_PASSWORD","REDIS_PASSWORD","DATABASE_URL","REDIS_URL",
  "JWT_ACCESS_SECRET","JWT_REFRESH_SECRET","AI_API_KEY","SMTP_PASSWORD",
  "RAZORPAY_KEY_SECRET","RAZORPAY_WEBHOOK_SECRET","PAYMENT_CREDENTIAL_ENCRYPTION_KEY",
  "COMMERCIAL_DOCUMENT_ENCRYPTION_KEY","AWS_SECRET_ACCESS_KEY",
  "LIVEKIT_API_KEY","LIVEKIT_API_SECRET","LIVEKIT_RECORDING_S3_ACCESS_KEY_ID",
  "LIVEKIT_RECORDING_S3_SECRET_ACCESS_KEY","TWILIO_AUTH_TOKEN",
  "WHATSAPP_ACCESS_TOKEN","WEB_PUSH_PRIVATE_KEY"];
function docker(args) {
  const result=spawnSync("docker",args,{encoding:"utf8",timeout:20000,maxBuffer:16*1024*1024});
  if (result.status!==0 || result.error) throw new Error("DOCKER_METADATA_READ_FAILED");
  return result.stdout;
}
export function reviewFreshBuild({image,history,role,source}) {
  const expectedDir=role==="API"?"/workspace/apps/api":"/app";
  const reasons=[];
  if (!/^sha256:[a-f0-9]{64}$/.test(image?.Id??"")) reasons.push("INVALID_IMAGE_ID");
  if (image?.Config?.WorkingDir!==expectedDir) reasons.push("ROLE_WORKDIR_MISMATCH");
  if (image?.Config?.Labels?.["org.opencontainers.image.revision"]!==source)
    reasons.push("BUILD_SOURCE_LABEL_MISMATCH");
  if (!Array.isArray(image?.RootFS?.Layers) || !image.RootFS.Layers.length)
    reasons.push("ROOTFS_MISSING");
  if (!Array.isArray(history) || !history.length || history.some(h=>typeof h!=="string"))
    reasons.push("HISTORY_MISSING");
  if (sensitiveAssignments(history).length) reasons.push("SECRET_ASSIGNMENT_IN_IMAGE_HISTORY");
  if ((image?.Config?.Env??[]).some(e=>
      typeof e==="string" && KEYS.some(k=>e.startsWith(k+"="))))
    reasons.push("SENSITIVE_IMAGE_ENV");
  return {role,status:reasons.length?"FAIL":"PASS_METADATA_ONLY",
    reasons:reasons.sort(),signedImageProvenance:false,layerContentSecretScan:false};
}
function main() {
  if (process.env.CI!=="true" || process.env.GITHUB_ACTIONS!=="true"
    || process.env.BBA_SYNTHETIC_BUILD!=="true")
    throw new Error("DISPOSABLE_CI_ONLY");
  const source=process.env.SCHOOLOS_BUILD_REVISION;
  if (!/^[0-9a-f]{40}$/.test(source??"")) throw new Error("UNPINNED_SOURCE");
  const ids=[
    ["API","schoolos-v5-ci-api:verification"],
    ["WEB","schoolos-v5-ci-web:verification"],
  ];
  const reports=ids.map(([role,tag])=>{
    const images=JSON.parse(docker(["image","inspect",tag]));
    const history=docker(["history","--no-trunc","--format","{{json .CreatedBy}}",tag])
      .trim().split("\n").map(line=>JSON.parse(line));
    return reviewFreshBuild({image:images?.[0],history,role,source});
  });
  // Nginx and backup are custom-built too. Earlier live observations
  // confirmed a nonempty DB/Redis history assignment in both, so CI must
  // test independent no-secret builds for both supporting images as well.
  // These two upstream-based Dockerfiles have no source revision OCI label;
  // this is a metadata check, NOT authenticated image provenance.
  for (const [role,tag] of [
    ["NGINX","schoolos-v5-ci-nginx:verification"],
    ["BACKUP","schoolos-v5-ci-backup:verification"],
  ]) {
    const images=JSON.parse(docker(["image","inspect",tag]));
    if(!Array.isArray(images) || images.length!==1)
      throw new Error("SUPPORT_IMAGE_NOT_FOUND");
    const history=docker(["history","--no-trunc","--format","{{json .CreatedBy}}",tag])
      .trim().split("\n").map(line=>JSON.parse(line));
    const result=reviewSupportingImage({
      image:images[0],id:images[0]?.Id,role,history
    });
    reports.push({
      role:result.role,status:result.status,reasons:result.reasons,
      signedImageProvenance:false,layerContentSecretScan:false
    });
  }
  const status=reports.every(r=>r.status==="PASS_METADATA_ONLY")?"PASS_METADATA_ONLY":"FAIL";
  console.log("SCHOOLOS_V5_SYNTHETIC_IMAGE_AUDIT "+JSON.stringify({
    status,reports,realCredentialsUsed:false,
    liveImagesChecked:false,imagesPublished:false,servicesChanged:false,
    valuesPrinted:false,liveCoolifySettingsVerified:false,
    signedProvenance:false,previousRollbackVerified:false,
    commercialReleaseAuthorized:false
  }));
  if (status!=="PASS_METADATA_ONLY")process.exitCode=1;
}
if (process.argv[1]?.endsWith("schoolos-v5-synthetic-build-audit.mjs")) {
  try {main();}
  catch {console.error("SCHOOLOS_V5_SYNTHETIC_IMAGE_AUDIT=CHECK_REQUIRED_NO_VALUES_PRINTED");
    process.exitCode=1;}
}
