#!/usr/bin/env node
/**
 * Read-only Coolify/Docker V5 staging acceptance PRECHECK, not a release GO.
 * Invokes only Docker ps/inspect. Never invokes compose, pull, build, restart,
 * database CLI, payment provider, or network write. Emits no secrets/URL users.
 */
import { spawnSync } from "node:child_process";

const services = ["postgres", "redis", "api", "web", "nginx", "backup"];
const appRevisionKey = "org.opencontainers.image.revision";
const labels = { project: "com.docker.compose.project", service: "com.docker.compose.service" };
const r2Mount = "/run/secrets/schoolos-v5-r2-credentials";
const razorpayMount = "/run/secrets/schoolos-v5-razorpay-api.env";

function entryEnvironment(container) {
  const values = new Map();
  for (const entry of container?.Config?.Env ?? []) {
    if (typeof entry !== "string") continue;
    const delimiter = entry.indexOf("=");
    if (delimiter > 0) values.set(entry.slice(0, delimiter), entry.slice(delimiter + 1));
  }
  return values;
}

export function approvedStagingProject(project) {
  return typeof project === "string"
    && /^[a-z0-9][a-z0-9_-]{4,63}$/.test(project)
    && !/production|main[-_]staging|^bba[-_]staging$/.test(project)
    && (project.includes("v5") || project === "96ffcu0jinuwlnaqxpltln4p");
}

export function inspectV5StagingContainers(containers, { project, sourceSha }) {
  if (!approvedStagingProject(project) || !/^[0-9a-f]{40}$/.test(sourceSha ?? "")) {
    return { status: "FAIL", reasons: ["INVALID_ISOLATED_TARGET_OR_SOURCE_SHA"], services: [],
      changesMade: false, realProviderTested: false, commercialReleaseAuthorized: false };
  }

  const reasons = [];
  const matched = containers.filter(c => c?.Config?.Labels?.[labels.project] === project);
  const detail = services.map(service => {
    const found = matched.filter(c => c?.Config?.Labels?.[labels.service] === service && c?.State?.Running === true);
    const container = [...found].sort((a, b) => String(b.Created ?? "").localeCompare(String(a.Created ?? "")))[0];
    if (found.length !== 1) reasons.push("RUNNING_SERVICE_COUNT_" + service.toUpperCase());
    if (!container) return { service, running: false, health: "MISSING", imageId: null,
      labelMatchesPinnedSource: null };
    const health = container.State?.Health?.Status ?? "NOT_CONFIGURED";
    if (health !== "healthy") reasons.push("SERVICE_NOT_HEALTHY_" + service.toUpperCase());
    const actualRevision = container.Config?.Labels?.[appRevisionKey];
    const labelMatchesPinnedSource = service === "api" || service === "web"
      ? actualRevision === sourceSha : null;
    if (labelMatchesPinnedSource === false) reasons.push("UNATTESTED_SOURCE_" + service.toUpperCase());
    return {
      service, running: true, health,
      imageId: /^[a-f0-9]{64}$/.test(String(container.Image ?? "").replace(/^sha256:/, ""))
        ? container.Image : null,
      labelMatchesPinnedSource,
    };
  });

  for (const container of matched) {
    const service = container.Config?.Labels?.[labels.service] ?? "";
    const env = entryEnvironment(container);
    // Verify BOTH ends of the host bind. A correct in-container destination
    // alone is insufficient if the host source was pointed at another file.
    const mounts = (container.Mounts ?? []).map(m => ({
      destination: m.Destination, source: m.Source,
      bind: m.Type === "bind", readOnly: m.RW === false,
    }));
    const r2Host = "/etc/schoolos/v5-staging/r2-aws-credentials";
    const razorpayHost = "/etc/schoolos/v5-staging/razorpay-v5-api.env";
    const r2 = mounts.filter(m => m.destination === r2Mount || m.source === r2Host);
    const razorpay = mounts.filter(m => m.destination === razorpayMount || m.source === razorpayHost);
    if (service === "backup"
      ? r2.length !== 1 || !r2[0].readOnly || !r2[0].bind
        || r2[0].source !== r2Host || r2[0].destination !== r2Mount
      : r2.length !== 0)
      reasons.push("R2_MOUNT_ISOLATION_" + String(service).toUpperCase());
    if (service === "api"
      ? razorpay.length !== 1 || !razorpay[0].readOnly || !razorpay[0].bind
        || razorpay[0].source !== razorpayHost || razorpay[0].destination !== razorpayMount
      : razorpay.length !== 0)
      reasons.push("PAYMENT_MOUNT_ISOLATION_" + String(service).toUpperCase());
    if (["BACKUP_AWS_ACCESS_KEY_ID", "BACKUP_AWS_SECRET_ACCESS_KEY"].some(k => env.has(k)))
      reasons.push("SHARED_BACKUP_KEY_EXPOSURE_" + String(service).toUpperCase());
    if (service !== "api" && ["RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"].some(k => env.has(k)))
      reasons.push("PAYMENT_KEY_EXPOSURE_" + String(service).toUpperCase());
    // V5 media credentials must not be inherited by the migrate, Web,
    // backup, proxy or database services. Check NONEMPTY values because
    // Compose may deliberately pass empty optional placeholders.
    // Never include secret values in the diagnostic result.
    if (service !== "api" && [
      "LIVEKIT_API_SECRET",
      "LIVEKIT_API_KEY",
      "LIVEKIT_RECORDING_S3_ACCESS_KEY_ID",
      "LIVEKIT_RECORDING_S3_SECRET_ACCESS_KEY",
    ].some(key => Boolean(env.get(key))))
      reasons.push("MEDIA_SECRET_EXPOSURE_" + String(service).toUpperCase());
    if (service === "api") {
      let dbSafe = false;
      try {
        const db = new URL(env.get("DATABASE_URL") ?? "");
        dbSafe = db.pathname === "/schoolos_v5_staging" && db.hostname === "postgres"
          && ["postgres:", "postgresql:"].includes(db.protocol);
      } catch { /* no URI printed */ }
      if (!dbSafe) reasons.push("API_DATABASE_NOT_ISOLATED_V5");
      if (env.get("WEB_URL") !== "https://v5-staging.beingbrilliantedu.com")
        reasons.push("API_DOMAIN_NOT_ISOLATED_V5");
      if (env.get("RAZORPAY_MODE") !== "test")
        reasons.push("API_RAZORPAY_NOT_TEST_MODE");
    }
  }

  // These checks prove only what running Docker containers claim. A matching
  // label can be forged; the Git revision and build log MUST be independently
  // reviewed before release. Never infer authenticated staging/customer UAT.
  return {
    status: reasons.length === 0 ? "PASS_TECHNICAL_SNAPSHOT_ONLY" : "FAIL",
    project, pinnedApplicationSource: sourceSha,
    reasons: [...new Set(reasons)].sort(), services: detail,
    revisionLabelIsSelfReported: true, sourceBuildProvenanceIndependentlyVerified: false,
    actualOffsiteRestoreVerified: false, realProviderTested: false,
    authenticatedCustomerUATVerified: false, commercialReleaseAuthorized: false,
    changesMade: false,
  };
}

export function runReadOnlyDockerAudit({ project, sourceSha }) {
  if (!approvedStagingProject(project) || !/^[0-9a-f]{40}$/.test(sourceSha ?? ""))
    throw new Error("REFUSED_NON_ISOLATED_STAGING_AUDIT");
  const list = spawnSync("docker",
    ["ps", "-aq", "--filter", "label=com.docker.compose.project=" + project],
    { encoding: "utf8", timeout: 15_000, maxBuffer: 128 * 1024 });
  if (list.status !== 0 || list.error) throw new Error("DOCKER_READ_ONLY_PS_FAILED");
  const ids = list.stdout.trim().split(/\s+/).filter(Boolean);
  if (!ids.length || ids.length > 50 || ids.some(id => !/^[a-f0-9]{12,64}$/.test(id)))
    throw new Error("ISOLATED_STAGING_CONTAINER_SET_INVALID");
  const inspection = spawnSync("docker", ["inspect", ...ids],
    { encoding: "utf8", timeout: 15_000, maxBuffer: 2 * 1024 * 1024 });
  if (inspection.status !== 0 || inspection.error) throw new Error("DOCKER_READ_ONLY_INSPECT_FAILED");
  let containers;
  try { containers = JSON.parse(inspection.stdout); } catch { throw new Error("DOCKER_INSPECT_FORMAT_INVALID"); }
  if (!Array.isArray(containers)) throw new Error("DOCKER_INSPECT_FORMAT_INVALID");
  return inspectV5StagingContainers(containers, { project, sourceSha });
}

if (process.argv[1]?.endsWith("schoolos-v5-staging-provenance.mjs")) {
  const options = Object.fromEntries(process.argv.slice(2).map(a => {
    const m = /^(--project|--source)=([^=]+)$/.exec(a);
    return m ? [m[1].slice(2), m[2]] : ["INVALID_OPTION", true];
  }));
  try {
    if ("INVALID_OPTION" in options || process.argv.length !== 4) throw new Error("INVALID_ARGUMENTS");
    const result = runReadOnlyDockerAudit({ project: options.project, sourceSha: options.source });
    console.log("SCHOOLOS_V5_STAGING_PROVENANCE " + JSON.stringify(result));
    if (result.status !== "PASS_TECHNICAL_SNAPSHOT_ONLY") process.exitCode = 1;
  } catch {
    console.error("SCHOOLOS_V5_STAGING_PROVENANCE_FAILED_NO_CREDENTIALS_PRINTED");
    process.exitCode = 1;
  }
}
