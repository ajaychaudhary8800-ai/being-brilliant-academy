#!/usr/bin/env node
/**
 * SchoolOS V5 staging local image availability evidence only.
 * No shell, compose, restart, pull, database calls, file writes, or provider IO.
 * Emits neither Docker Env nor registry/repository names or credentials.
 * Local image IDs + OCI revision labels are NOT a source-build attestation.
 */
import { spawnSync } from "node:child_process";
import { approvedStagingProject, inspectV5StagingContainers } from "./schoolos-v5-staging-provenance.mjs";

const label = "org.opencontainers.image.revision";
const shaPattern = /^[a-f0-9]{40}$/;
const imagePattern = /^sha256:[a-f0-9]{64}$/;
const workingDirs = { api: "/workspace/apps/api", web: "/app" };
const composeLabel = "com.docker.compose.service";
const projectLabel = "com.docker.compose.project";

function imageSummary(images, id, role, expectedSource) {
  const validId = imagePattern.test(id ?? "");
  const hits = validId ? images.filter(i => i?.Id === id) : [];
  const image = hits.length === 1 ? hits[0] : null;
  const labelMatches = image?.Config?.Labels?.[label] === expectedSource;
  const roleMatches = image?.Config?.WorkingDir === workingDirs[role];
  const registryManifestDigestsObserved = [...new Set((image?.RepoDigests ?? [])
    .filter(v => typeof v === "string")
    .map(v => v.match(/@sha256:([a-f0-9]{64})$/)?.[1])
    .filter(Boolean))].sort().map(hex => "sha256:" + hex);
  return {
    role, localImageId: validId ? id : null,
    locallyAvailable: Boolean(image), expectedRevisionLabelMatches: Boolean(labelMatches),
    expectedRoleWorkdirMatches: Boolean(roleMatches),
    registryManifestDigestsObserved,
    revisionLabelIsSelfReported: true,
    authenticatedSourceBuildAttestation: false,
  };
}

export function assessV5ImageInventory(containers, images, {
  project, sourceSha, rollbackApiId = null, rollbackWebId = null, rollbackSourceSha = null,
}) {
  if (!approvedStagingProject(project) || !shaPattern.test(sourceSha ?? ""))
    throw new Error("INVALID_ISOLATED_TARGET_OR_SOURCE");
  const rollbackRequested = rollbackApiId !== null || rollbackWebId !== null
    || rollbackSourceSha !== null;
  if (rollbackRequested && (!imagePattern.test(rollbackApiId ?? "")
    || !imagePattern.test(rollbackWebId ?? "") || !shaPattern.test(rollbackSourceSha ?? "")))
    throw new Error("INCOMPLETE_PINNED_ROLLBACK_TRIPLE");
  const active = {};
  for (const role of ["api", "web"]) {
    const found = containers.filter(c => c?.Config?.Labels?.[projectLabel] === project
      && c?.Config?.Labels?.[composeLabel] === role && c?.State?.Running === true);
    active[role] = found.length === 1 ? found[0] : null;
  }
  const current = {
    api: imageSummary(images, active.api?.Image, "api", sourceSha),
    web: imageSummary(images, active.web?.Image, "web", sourceSha),
  };
  const currentPass = Object.values(current).every(item =>
    item.locallyAvailable && item.expectedRevisionLabelMatches
    && item.expectedRoleWorkdirMatches);
  const rollback = rollbackRequested ? {
    api: imageSummary(images, rollbackApiId, "api", rollbackSourceSha),
    web: imageSummary(images, rollbackWebId, "web", rollbackSourceSha),
  } : null;
  const rollbackPairPresent = Boolean(rollback && Object.values(rollback).every(item =>
    item.locallyAvailable && item.expectedRevisionLabelMatches
    && item.expectedRoleWorkdirMatches)
    && rollbackApiId !== rollbackWebId
    && rollbackApiId !== current.api.localImageId
    && rollbackWebId !== current.web.localImageId);
  return {
    project, sourceSha, current, rollback,
    currentPairLocallyAvailableAndLabeled: currentPass,
    rollbackPairLocallyAvailableAndLabeled: rollbackPairPresent,
    rollbackCompatibilityVerified: false,
    authenticatedImageProvenanceVerified: false,
    approvedRollbackProcedure: false,
    productionDeploymentAuthorized: false,
    changesMade: false,
    status: currentPass && rollbackPairPresent
      ? "LOCAL_IMAGE_INVENTORY_PASS_REVIEW_REQUIRED" : "CHECK_REQUIRED",
  };
}

function dockerJson(args, maxBuffer = 2 * 1024 * 1024) {
  const result = spawnSync("docker", args, {
    encoding: "utf8", timeout: 20_000, maxBuffer,
  });
  if (result.status !== 0 || result.error) throw new Error("DOCKER_METADATA_READ_FAILED");
  try { return JSON.parse(result.stdout); }
  catch { throw new Error("DOCKER_METADATA_FORMAT_INVALID"); }
}

function dockerIds(project) {
  const result = spawnSync("docker",
    ["ps", "-aq", "--filter", "label=com.docker.compose.project=" + project],
    { encoding: "utf8", timeout: 15_000, maxBuffer: 128 * 1024 });
  if (result.status !== 0 || result.error) throw new Error("DOCKER_INVENTORY_READ_FAILED");
  const ids = result.stdout.trim().split(/\s+/).filter(Boolean);
  if (!ids.length || ids.length > 50 || ids.some(x => !/^[a-f0-9]{12,64}$/.test(x)))
    throw new Error("ISOLATED_CONTAINER_INVENTORY_INVALID");
  return ids;
}

export function runReadOnlyImageInventory(options) {
  const { project, sourceSha, rollbackApiId = null, rollbackWebId = null,
    rollbackSourceSha = null } = options;
  if (!approvedStagingProject(project) || !shaPattern.test(sourceSha ?? ""))
    throw new Error("REFUSED_UNSCOPED_STAGING_AUDIT");
  const ids = dockerIds(project);
  const containers = dockerJson(["inspect", ...ids]);
  if (!Array.isArray(containers)) throw new Error("INVALID_CONTAINER_INSPECTION");
  const security = inspectV5StagingContainers(containers, { project, sourceSha });
  const activeImages = containers
    .filter(c => c?.Config?.Labels?.[projectLabel] === project
      && ["api", "web"].includes(c?.Config?.Labels?.[composeLabel])
      && c?.State?.Running === true)
    .map(c => c.Image).filter(x => imagePattern.test(x ?? ""));
  const selected = [...new Set([...activeImages, rollbackApiId, rollbackWebId]
    .filter(x => imagePattern.test(x ?? "")))];
  const images = [];
  for (const id of selected) {
    // Missing old image is an acceptable CHECK_REQUIRED outcome, not a reason
    // to pull or rebuild it behind the operator's back.
    try {
      const found = dockerJson(["image", "inspect", id], 512 * 1024);
      if (Array.isArray(found)) images.push(...found);
    } catch { /* absent or unreadable image => fail-closed inventory */ }
  }
  const report = assessV5ImageInventory(containers, images, options);
  return {
    ...report,
    securityRuntimeSnapshot: security.status,
    securityReasonCodes: security.reasons,
    status: security.status === "PASS_TECHNICAL_SNAPSHOT_ONLY" ? report.status : "CHECK_REQUIRED",
    independentlySigned: false,
  };
}

if (process.argv[1]?.endsWith("schoolos-v5-image-rollback-inventory.mjs")) {
  const keys = new Set(["project", "source", "rollback-api", "rollback-web", "rollback-source"]);
  const args = {};
  let invalid = false;
  for (const arg of process.argv.slice(2)) {
    const match = /^--([a-z-]+)=(.+)$/.exec(arg);
    if (!match || !keys.has(match[1]) || Object.hasOwn(args, match[1])) invalid = true;
    else args[match[1]] = match[2];
  }
  try {
    if (invalid || !args.project || !args.source) throw new Error("INVALID_OPTIONS");
    const options = {
      project: args.project, sourceSha: args.source,
      rollbackApiId: args["rollback-api"] ?? null,
      rollbackWebId: args["rollback-web"] ?? null,
      rollbackSourceSha: args["rollback-source"] ?? null,
    };
    const report = runReadOnlyImageInventory(options);
    console.log("SCHOOLOS_V5_IMAGE_ROLLBACK_INVENTORY " + JSON.stringify(report));
    if (report.status === "CHECK_REQUIRED") process.exitCode = 1;
  } catch {
    console.error("SCHOOLOS_V5_IMAGE_ROLLBACK_INVENTORY_CHECK_REQUIRED_NO_SECRETS_PRINTED");
    process.exitCode = 1;
  }
}
