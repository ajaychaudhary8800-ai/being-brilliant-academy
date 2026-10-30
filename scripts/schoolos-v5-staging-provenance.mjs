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
const mediaMount = "/run/secrets/schoolos-v5-livekit-api.env";
const appMount = "/run/secrets/schoolos-v5-app-api.env";

function entryEnvironment(container) {
  const values = new Map();
  for (const entry of container?.Config?.Env ?? []) {
    if (typeof entry !== "string") continue;
    const delimiter = entry.indexOf("=");
    if (delimiter > 0) values.set(entry.slice(0, delimiter), entry.slice(delimiter + 1));
  }
  return values;
}

// Test every Docker Env entry, not just the last duplicate key in the
// convenience Map. A nonempty key shadowed by a later empty placeholder
// must still veto staging security acceptance.
function hasNonemptyEnvironmentValue(container, key) {
  return (container?.Config?.Env ?? []).some(entry =>
    typeof entry === "string" && entry.startsWith(key + "=")
      && entry.length > key.length + 1);
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
  // The one-shot migration is deliberately stopped after a successful deploy.
  // It must still be present in Docker's all-container inventory for the
  // secret-scope audit; otherwise 6/6 running services could falsely pass.
  const migrations = matched.filter(c => c?.Config?.Labels?.[labels.service] === "migrate");
  if (migrations.length !== 1) reasons.push("MIGRATION_CONTAINER_COUNT");
  const migration = migrations.length === 1 ? migrations[0] : null;
  const migrationExitedSuccessfully = Boolean(migration
    && migration.State?.Running === false && migration.State?.ExitCode === 0);
  if (migration && !migrationExitedSuccessfully)
    reasons.push("MIGRATION_NOT_SUCCESSFULLY_STOPPED");
  const dataVolumes = new Map();
  const detail = services.map(service => {
    const found = matched.filter(c => c?.Config?.Labels?.[labels.service] === service && c?.State?.Running === true);
    const container = [...found].sort((a, b) => String(b.Created ?? "").localeCompare(String(a.Created ?? "")))[0];
    if (found.length !== 1) reasons.push("RUNNING_SERVICE_COUNT_" + service.toUpperCase());
    if (!container) return { service, running: false, health: "MISSING", imageId: null,
      labelMatchesPinnedSource: null };
    const health = container.State?.Health?.Status ?? "NOT_CONFIGURED";
    if (health !== "healthy") reasons.push("SERVICE_NOT_HEALTHY_" + service.toUpperCase());
    const actualRevision = container.Config?.Labels?.[appRevisionKey];
    // The reviewed Compose uses project-scoped named volumes. Unexpected
    // names require operator review, never automatic recreation or migration.
    const requiredMounts = {
      postgres: [["postgres_data", "/var/lib/postgresql/data", true]],
      redis: [["redis_data", "/data", true]],
      api: [["app_storage", "/data/storage", true]],
      backup: [["backups", "/backups", true], ["app_storage", "/data/storage", false]],
    }[service] ?? [];
    for (const [name, destination, writable] of requiredMounts) {
      const mounts = (container.Mounts ?? []).filter(m => m.Destination === destination);
      const mount = mounts[0];
      if (mounts.length !== 1 || mount.Type !== "volume"
        || ![project + "_" + name, project + "_" + name.replaceAll("_", "-")].includes(mount.Name) || (writable && mount.RW !== true))
        reasons.push("PERSISTENT_VOLUME_" + service.toUpperCase() + "_" + name.toUpperCase());
      dataVolumes.set(service + ":" + destination, mount?.Name);
    }
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
  const uploadVolume = dataVolumes.get("api:/data/storage");
  if (!uploadVolume || uploadVolume !== dataVolumes.get("backup:/data/storage"))
    reasons.push("APP_STORAGE_BACKUP_VOLUME_MISMATCH");

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
    const mediaHost = "/etc/schoolos/v5-staging/livekit-v5-api.env";
    const appHost = "/etc/schoolos/v5-staging/app-v5-api.env";
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
    const media = mounts.filter(m => m.destination === mediaMount || m.source === mediaHost);
    if (service === "api"
      ? media.length !== 1 || !media[0].readOnly || !media[0].bind
        || media[0].source !== mediaHost || media[0].destination !== mediaMount
      : media.length !== 0)
      reasons.push("MEDIA_MOUNT_ISOLATION_" + String(service).toUpperCase());
    const app = mounts.filter(m => m.destination === appMount || m.source === appHost);
    if (service === "api"
      ? app.length !== 1 || !app[0].readOnly || !app[0].bind
        || app[0].source !== appHost || app[0].destination !== appMount
      : app.length !== 0)
      reasons.push("APP_MOUNT_ISOLATION_" + String(service).toUpperCase());
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
    ].some(key => hasNonemptyEnvironmentValue(container, key)))
      reasons.push("MEDIA_SECRET_EXPOSURE_" + String(service).toUpperCase());
    // Coolify can inject globally configured values independently of the
    // reviewed Compose environment block. Inspect stopped migration services
    // too; presence of nonempty API-only runtime secrets is a release veto.
    // Never return secret values or the underlying Docker Config.Env array.
    if (service !== "api" && [
      "JWT_ACCESS_SECRET",
      "JWT_REFRESH_SECRET",
      "AI_API_KEY",
      "SMTP_PASSWORD",
      "TWILIO_AUTH_TOKEN",
      "WHATSAPP_ACCESS_TOKEN",
      "WEB_PUSH_PRIVATE_KEY",
      "PAYMENT_CREDENTIAL_ENCRYPTION_KEY",
      "COMMERCIAL_DOCUMENT_ENCRYPTION_KEY",
      "AWS_SECRET_ACCESS_KEY",
    ].some(key => hasNonemptyEnvironmentValue(container, key)))
      reasons.push("API_RUNTIME_SECRET_EXPOSURE_" + String(service).toUpperCase());
    if (service === "api") {
      if (env.get("SCHOOLOS_V5_APP_ENV_FILE") !== appMount)
        reasons.push("API_APP_FILE_NOT_CONFIGURED");
      if (env.get("SCHOOLOS_V5_LIVEKIT_ENV_FILE") !== mediaMount)
        reasons.push("API_MEDIA_FILE_NOT_CONFIGURED");
      for (const flag of ["SCHOOLOS_VIDEO_ADMISSION_ENABLED",
        "SCHOOLOS_VIDEO_SETTLEMENT_ENABLED", "SCHOOLOS_VIDEO_ZERO_RELEASE_ENABLED"]) {
        // Missing means false in config.ts. Reject unexpected values too.
        if (env.has(flag) && env.get(flag) !== "false")
          reasons.push("PAID_VIDEO_FLAG_NOT_DISABLED");
      }
      if (env.has("LOCAL_STORAGE_PATH") && env.get("LOCAL_STORAGE_PATH") !== "/data/storage")
        reasons.push("API_STORAGE_PATH_OUTSIDE_REVIEWED_VOLUME");
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
    if (service === "postgres" && env.has("PGDATA")
      && env.get("PGDATA") !== "/var/lib/postgresql/data"
      && !/^\/var\/lib\/postgresql\/data\/(?!.*(?:^|\/)\.\.(?:\/|$))[a-zA-Z0-9_/-]+$/.test(env.get("PGDATA")))
      reasons.push("POSTGRES_DATA_PATH_OUTSIDE_REVIEWED_VOLUME");
  }

  // These checks prove only what running Docker containers claim. A matching
  // label can be forged; the Git revision and build log MUST be independently
  // reviewed before release. Never infer authenticated staging/customer UAT.
  return {
    status: reasons.length === 0 ? "PASS_TECHNICAL_SNAPSHOT_ONLY" : "FAIL",
    project, pinnedApplicationSource: sourceSha,
    reasons: [...new Set(reasons)].sort(), services: detail,
    migration: { count: migrations.length, exitedSuccessfully: migrationExitedSuccessfully },
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
