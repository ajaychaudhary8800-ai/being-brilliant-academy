import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { approvedStagingProject, inspectV5StagingContainers } from "./schoolos-v5-staging-provenance.mjs";
import { assessV5ImageInventory } from "./schoolos-v5-image-rollback-inventory.mjs";

const sha = "a".repeat(40);
const project = "96ffcu0jinuwlnaqxpltln4p";
const names = ["postgres", "redis", "api", "web", "nginx", "backup"];
function container(service) {
  const env = service === "api"
    ? ["DATABASE_URL=postgresql://secret-user:secret-pass@postgres:5432/schoolos_v5_staging",
      "WEB_URL=https://v5-staging.beingbrilliantedu.com", "RAZORPAY_MODE=test",
      "SCHOOLOS_V5_LIVEKIT_ENV_FILE=/run/secrets/schoolos-v5-livekit-api.env",
      "SCHOOLOS_V5_APP_ENV_FILE=/run/secrets/schoolos-v5-app-api.env"]
    : [];
  const mounts = service === "api"
    ? [{ Destination: "/run/secrets/schoolos-v5-razorpay-api.env", Source: "/etc/schoolos/v5-staging/razorpay-v5-api.env", Type: "bind", RW: false },
      { Destination: "/run/secrets/schoolos-v5-livekit-api.env", Source: "/etc/schoolos/v5-staging/livekit-v5-api.env", Type: "bind", RW: false },
      { Destination: "/run/secrets/schoolos-v5-app-api.env", Source: "/etc/schoolos/v5-staging/app-v5-api.env", Type: "bind", RW: false }]
    : service === "backup"
      ? [{ Destination: "/run/secrets/schoolos-v5-r2-credentials", Source: "/etc/schoolos/v5-staging/r2-aws-credentials", Type: "bind", RW: false }]
      : [];
  return {
    Created: "2026-10-23T00:00:00Z",
    Image: "sha256:" + "b".repeat(64),
    Config: {
      Env: env, Labels: {
        "com.docker.compose.project": project,
        "com.docker.compose.service": service,
        ...(service === "api" || service === "web"
          ? { "org.opencontainers.image.revision": sha } : {}),
      },
    },
    State: { Running: true, Health: { Status: "healthy" } },
    Mounts: [...mounts, ...({
      postgres: [["postgres_data", "/var/lib/postgresql/data"]],
      redis: [["redis_data", "/data"]],
      api: [["app_storage", "/data/storage"]],
      backup: [["backups", "/backups"], ["app_storage", "/data/storage"]],
    }[service] ?? []).map(([name, destination]) => ({
      Type: "volume", Name: project + "_" + name,
      Destination: destination, RW: true,
    }))],
  };
}
const fixtures = () => [
  ...names.map(container),
  { ...container("migrate"), State: { Running: false, ExitCode: 0 } },
];
const check = list => inspectV5StagingContainers(list, { project, sourceSha: sha });

test("hyphenated Coolify volumes work", () => {
  const list = fixtures();
  for (const c of list)
    for (const m of c.Mounts)
      if (m.Name) m.Name = m.Name.replaceAll("_data", "-data").replaceAll("_storage", "-storage");
  assert.equal(check(list).status, "PASS_TECHNICAL_SNAPSHOT_ONLY");
});

test("missing, ephemeral, foreign or read-only data mounts fail closed", () => {
  for (const service of ["postgres", "redis", "api", "backup"]) {
    for (const mode of ["missing", "tmpfs", "foreign", "readonly"]) {
      const entries = fixtures();
      const target = entries.find(c => c.Config.Labels["com.docker.compose.service"] === service);
      const mount = target.Mounts.find(m => m.Type === "volume");
      if (mode === "missing") target.Mounts = target.Mounts.filter(m => m !== mount);
      if (mode === "tmpfs") mount.Type = "tmpfs";
      if (mode === "foreign") mount.Name = "bba-production_data";
      if (mode === "readonly") mount.RW = false;
      assert.equal(check(entries).status, "FAIL", service + "/" + mode);
    }
  }
});

test("backup must read the API's exact upload volume", () => {
  const entries = fixtures();
  entries.find(c => c.Config.Labels["com.docker.compose.service"] === "backup")
    .Mounts.find(m => m.Destination === "/data/storage").Name = project + "_other_storage";
  assert.ok(check(entries).reasons.includes("APP_STORAGE_BACKUP_VOLUME_MISMATCH"));
});

test("paid-video flags cannot be enabled in the staging acceptance snapshot", () => {
  for (const flag of ["SCHOOLOS_VIDEO_ADMISSION_ENABLED", "SCHOOLOS_VIDEO_SETTLEMENT_ENABLED", "SCHOOLOS_VIDEO_ZERO_RELEASE_ENABLED"]) {
    const entries = fixtures();
    entries.find(c => c.Config.Labels["com.docker.compose.service"] === "api").Config.Env.push(flag + "=true");
    assert.ok(check(entries).reasons.includes("PAID_VIDEO_FLAG_NOT_DISABLED"));
  }
});

test("storage overrides and duplicate data mounts cannot hide missing persistence", () => {
  for (const [service, variable] of [["api", "LOCAL_STORAGE_PATH"], ["postgres", "PGDATA"]]) {
    for (const value of ["/tmp/ephemeral", "/var/lib/postgresql/data/../outside"]) {
      const entries = fixtures();
      entries.find(c => c.Config.Labels["com.docker.compose.service"] === service)
        .Config.Env.push(variable + "=" + value);
      assert.equal(check(entries).status, "FAIL", variable + "/" + value);
    }
  }
  const entries = fixtures();
  entries[0].Mounts.push({ ...entries[0].Mounts[0] });
  assert.equal(check(entries).status, "FAIL");
});

test("read-only backup access to shared uploads and nested PGDATA remain valid", () => {
  const entries = fixtures();
  entries.find(c => c.Config.Labels["com.docker.compose.service"] === "backup")
    .Mounts.find(m => m.Destination === "/data/storage").RW = false;
  entries[0].Config.Env.push("PGDATA=/var/lib/postgresql/data/pgdata");
  assert.equal(check(entries).status, "PASS_TECHNICAL_SNAPSHOT_ONLY");
});

test("full isolated V5 inventory is informational and never claims paid commercial GO", () => {
  const result = check(fixtures());
  assert.equal(result.status, "PASS_TECHNICAL_SNAPSHOT_ONLY");
  assert.deepEqual(result.reasons, []);
  assert.equal(result.sourceBuildProvenanceIndependentlyVerified, false);
  assert.equal(result.realProviderTested, false);
  assert.equal(result.commercialReleaseAuthorized, false);
  assert.equal(result.changesMade, false);
  assert.equal(result.services.length, names.length);
  assert.ok(result.services.every(x => x.health === "healthy" && x.imageId));
});

test("stopped V5 migration must be present exactly once and have succeeded", () => {
  const withoutMigration = fixtures().filter(x => x.Config.Labels["com.docker.compose.service"] !== "migrate");
  const missing = check(withoutMigration);
  assert.equal(missing.status, "FAIL");
  assert.ok(missing.reasons.includes("MIGRATION_CONTAINER_COUNT"));
  assert.deepEqual(missing.migration, { count: 0, exitedSuccessfully: false });

  const duplicated = fixtures();
  duplicated.push({ ...duplicated.find(x => x.Config.Labels["com.docker.compose.service"] === "migrate") });
  assert.ok(check(duplicated).reasons.includes("MIGRATION_CONTAINER_COUNT"));

  for (const state of [
    { Running: true, ExitCode: 0 },
    { Running: false, ExitCode: 1 },
    { Running: false },
  ]) {
    const containers = fixtures();
    containers.find(x => x.Config.Labels["com.docker.compose.service"] === "migrate").State = state;
    const result = check(containers);
    assert.equal(result.status, "FAIL");
    assert.ok(result.reasons.includes("MIGRATION_NOT_SUCCESSFULLY_STOPPED"));
    assert.equal(result.migration.exitedSuccessfully, false);
  }

  const successful = check(fixtures());
  assert.equal(successful.status, "PASS_TECHNICAL_SNAPSHOT_ONLY");
  assert.deepEqual(successful.migration, { count: 1, exitedSuccessfully: true });
});

test("any unlabelled or mislabelled API/web image blocks staging parity", () => {
  const entries = fixtures();
  entries.find(x => x.Config.Labels["com.docker.compose.service"] === "web")
    .Config.Labels["org.opencontainers.image.revision"] = "c".repeat(40);
  assert.equal(check(entries).status, "FAIL");
  assert.ok(check(entries).reasons.includes("UNATTESTED_SOURCE_WEB"));
});

test("staging database, payment mode, API URL and health fail closed", () => {
  const entries = fixtures();
  const api = entries.find(x => x.Config.Labels["com.docker.compose.service"] === "api");
  api.Config.Env = [
    "DATABASE_URL=postgresql://secret-user:secret-pass@prod:5432/bba",
    "WEB_URL=https://beingbrilliantedu.com", "RAZORPAY_MODE=live",
  ];
  entries.find(x => x.Config.Labels["com.docker.compose.service"] === "backup").State.Health.Status = "unhealthy";
  const result = check(entries);
  for (const code of ["API_DATABASE_NOT_ISOLATED_V5", "API_DOMAIN_NOT_ISOLATED_V5",
    "API_RAZORPAY_NOT_TEST_MODE", "SERVICE_NOT_HEALTHY_BACKUP"])
    assert.ok(result.reasons.includes(code), code);
});

test("read-only V5 runtime audit rejects backup key leakage and secret mount drift", () => {
  const entries = fixtures();
  entries.find(x => x.Config.Labels["com.docker.compose.service"] === "web")
    .Config.Env = ["BACKUP_AWS_SECRET_ACCESS_KEY=do-not-print", "RAZORPAY_KEY_SECRET=do-not-print"];
  entries.find(x => x.Config.Labels["com.docker.compose.service"] === "backup")
    .Mounts = [{ Destination: "/run/secrets/schoolos-v5-r2-credentials", RW: true }];
  const result = check(entries);
  assert.ok(result.reasons.includes("SHARED_BACKUP_KEY_EXPOSURE_WEB"));
  assert.ok(result.reasons.includes("PAYMENT_KEY_EXPOSURE_WEB"));
  assert.ok(result.reasons.includes("R2_MOUNT_ISOLATION_BACKUP"));
  assert.ok(!JSON.stringify(result).includes("do-not-print"));
  assert.ok(!JSON.stringify(result).includes("secret-pass"));
});

test("media secret file mount must be API only and read-only", () => {
  const entries = fixtures();
  const api = entries.find(x => x.Config.Labels["com.docker.compose.service"] === "api");
  const mount = api.Mounts.find(x => x.Destination === "/run/secrets/schoolos-v5-livekit-api.env");
  mount.RW = true;
  assert.ok(check(entries).reasons.includes("MEDIA_MOUNT_ISOLATION_API"));
  mount.RW = false;
  const web = entries.find(x => x.Config.Labels["com.docker.compose.service"] === "web");
  web.Mounts.push({ ...mount });
  assert.ok(check(entries).reasons.includes("MEDIA_MOUNT_ISOLATION_WEB"));
});

test("read-only V5 runtime audit confines nonempty LiveKit keys to the API", () => {
  const sensitiveKeys = [
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
    "LIVEKIT_RECORDING_S3_ACCESS_KEY_ID",
    "LIVEKIT_RECORDING_S3_SECRET_ACCESS_KEY",
  ];
  for (const service of names.filter(value => value !== "api")) {
    for (const key of sensitiveKeys) {
      const entries = fixtures();
      const target = entries.find(x => x.Config.Labels["com.docker.compose.service"] === service);
      target.Config.Env.push(key + "=do-not-print-media-key");
      const result = check(entries);
      assert.equal(result.status, "FAIL", service + "/" + key);
      assert.ok(result.reasons.includes("MEDIA_SECRET_EXPOSURE_" + service.toUpperCase()), service + "/" + key);
      assert.ok(!JSON.stringify(result).includes("do-not-print-media-key"), "No provider secrets in audit output");
    }
  }
});

test("empty media placeholders are safe and API-only media secrets are allowed", () => {
  const entries = fixtures();
  const web = entries.find(x => x.Config.Labels["com.docker.compose.service"] === "web");
  const api = entries.find(x => x.Config.Labels["com.docker.compose.service"] === "api");
  web.Config.Env.push("LIVEKIT_API_KEY=", "LIVEKIT_API_SECRET=", "LIVEKIT_RECORDING_S3_SECRET_ACCESS_KEY=");
  api.Config.Env.push("LIVEKIT_API_KEY=qa", "LIVEKIT_API_SECRET=secret-should-not-print",
    "LIVEKIT_RECORDING_S3_SECRET_ACCESS_KEY=secret-should-not-print");
  const result = check(entries);
  assert.equal(result.status, "PASS_TECHNICAL_SNAPSHOT_ONLY");
  assert.ok(!JSON.stringify(result).includes("secret-should-not-print"));
});

test("protected V5 app credential file is mounted API-only, read-only and from exact host source", () => {
  const c = fixtures();
  const api = c.find(x => x.Config.Labels["com.docker.compose.service"] === "api");
  const mount = api.Mounts.find(m => m.Destination === "/run/secrets/schoolos-v5-app-api.env");
  assert.equal(check(c).status, "PASS_TECHNICAL_SNAPSHOT_ONLY");
  mount.RW = true;
  assert.ok(check(c).reasons.includes("APP_MOUNT_ISOLATION_API"));
  mount.RW = false;
  mount.Source = "/tmp/misplaced-file.env";
  assert.ok(check(c).reasons.includes("APP_MOUNT_ISOLATION_API"));
  mount.Source = "/etc/schoolos/v5-staging/app-v5-api.env";
  const web = c.find(x => x.Config.Labels["com.docker.compose.service"] === "web");
  web.Mounts.push({ ...mount });
  assert.ok(check(c).reasons.includes("APP_MOUNT_ISOLATION_WEB"));
  web.Mounts.pop();
  api.Config.Env = api.Config.Env.filter(x => !x.startsWith("SCHOOLOS_V5_APP_ENV_FILE="));
  assert.ok(check(c).reasons.includes("API_APP_FILE_NOT_CONFIGURED"));
});

test("stopped migrate and all non-API services reject nonempty application secrets without printing values", () => {
  const forbidden = [
    "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "AI_API_KEY", "SMTP_PASSWORD",
    "TWILIO_AUTH_TOKEN", "WHATSAPP_ACCESS_TOKEN", "WEB_PUSH_PRIVATE_KEY",
    "PAYMENT_CREDENTIAL_ENCRYPTION_KEY", "COMMERCIAL_DOCUMENT_ENCRYPTION_KEY",
    "AWS_SECRET_ACCESS_KEY",
  ];
  for (const service of [...names.filter(value => value !== "api"), "migrate"]) {
    for (const key of forbidden) {
      const entries = fixtures();
      const target = entries.find(x => x.Config.Labels["com.docker.compose.service"] === service);
      target.Config.Env.push(key + "=test-sensitive-never-print");
      const result = check(entries);
      assert.equal(result.status, "FAIL", service + "/" + key);
      assert.ok(result.reasons.includes("API_RUNTIME_SECRET_EXPOSURE_" + service.toUpperCase()));
      assert.ok(!JSON.stringify(result).includes("test-sensitive-never-print"));
    }
  }
});

test("empty optional placeholders and API-specific runtime secrets do not falsely fail", () => {
  const entries = fixtures();
  const migrate = entries.find(x => x.Config.Labels["com.docker.compose.service"] === "migrate");
  migrate.Config.Env.push("JWT_ACCESS_SECRET=", "SMTP_PASSWORD=");
  const api = entries.find(x => x.Config.Labels["com.docker.compose.service"] === "api");
  api.Config.Env.push("JWT_ACCESS_SECRET=api-only-opaque-value", "SMTP_PASSWORD=api-only-mail-value");
  const result = check(entries);
  assert.equal(result.status, "PASS_TECHNICAL_SNAPSHOT_ONLY");
  assert.ok(!JSON.stringify(result).includes("api-only-opaque-value"));
  assert.ok(!JSON.stringify(result).includes("api-only-mail-value"));
});

test("duplicate empty Docker Env entries cannot conceal nonempty API-only secrets", () => {
  for (const [service, key] of [
    ["migrate", "JWT_ACCESS_SECRET"],
    ["web", "SMTP_PASSWORD"],
    ["backup", "COMMERCIAL_DOCUMENT_ENCRYPTION_KEY"],
    ["nginx", "LIVEKIT_API_SECRET"],
    ["postgres", "AI_API_KEY"],
    ["redis", "LIVEKIT_RECORDING_S3_SECRET_ACCESS_KEY"],
  ]) {
    const entries = fixtures();
    const target = entries.find(x => x.Config.Labels["com.docker.compose.service"] === service);
    target.Config.Env.push(key + "=never-print-shadowed-secret", key + "=");
    const audit = check(entries);
    assert.equal(audit.status, "FAIL", service);
    const expected = key.startsWith("LIVEKIT_")
      ? "MEDIA_SECRET_EXPOSURE_" : "API_RUNTIME_SECRET_EXPOSURE_";
    assert.ok(audit.reasons.includes(expected + service.toUpperCase()));
    assert.ok(!JSON.stringify(audit).includes("never-print-shadowed-secret"));
  }
});

test("repository labels cannot identify V4 production or legacy staging as V5", () => {
  assert.equal(approvedStagingProject("bba-production"), false);
  assert.equal(approvedStagingProject("bba-staging"), false);
  assert.equal(approvedStagingProject("main-staging"), false);
  assert.equal(approvedStagingProject(project), true);
  assert.equal(approvedStagingProject("schoolos-v5-staging"), true);
  const attempt = inspectV5StagingContainers(fixtures(), { project: "bba-production", sourceSha: sha });
  assert.equal(attempt.status, "FAIL");
  assert.equal(attempt.changesMade, false);
});

test("only isolated V5 compose receives pinned build-arg, script is read-only", async () => {
  const api = await readFile(new URL("../apps/api/Dockerfile", import.meta.url), "utf8");
  const web = await readFile(new URL("../apps/web/Dockerfile", import.meta.url), "utf8");
  const compose = await readFile(new URL("../docker-compose.schoolos-v5-staging.yml", import.meta.url), "utf8");
  const audit = await readFile(new URL("./schoolos-v5-staging-provenance.mjs", import.meta.url), "utf8");
  for (const dockerfile of [api, web]) {
    assert.match(dockerfile, /ARG SCHOOLOS_BUILD_REVISION=unattested/);
    assert.match(dockerfile, /LABEL org\.opencontainers\.image\.revision=\$SCHOOLOS_BUILD_REVISION/);
  }
  assert.match(compose, /SCHOOLOS_BUILD_REVISION: "\$\{SCHOOLOS_BUILD_REVISION:-unattested\}"/);
  assert.equal(compose.split('SCHOOLOS_BUILD_REVISION: "${SCHOOLOS_BUILD_REVISION:-unattested}"').length - 1, 2);
  assert.match(audit, /\["ps", "-aq", "--filter"/);
  assert.match(audit, /\["inspect", \.\.\.ids\]/);
  assert.doesNotMatch(audit, /spawnSync\(["'](?:bash|sh|sudo)["']/);
  assert.doesNotMatch(audit, /docker\s+(?:build|run|compose|exec|restart|rm|pull)/);
});

function imageInventoryFixtures() {
  const current = fixtures();
  const api = current.find(x => x.Config.Labels["com.docker.compose.service"] === "api");
  const web = current.find(x => x.Config.Labels["com.docker.compose.service"] === "web");
  const currentApiId = "sha256:" + "1".repeat(64);
  const currentWebId = "sha256:" + "2".repeat(64);
  const rollbackApiId = "sha256:" + "3".repeat(64);
  const rollbackWebId = "sha256:" + "4".repeat(64);
  const rollbackSourceSha = "c".repeat(40);
  api.Image = currentApiId;
  web.Image = currentWebId;
  const make = (id, role, revision) => ({
    Id: id,
    Config: {
      WorkingDir: role === "api" ? "/workspace/apps/api" : "/app",
      Labels: { "org.opencontainers.image.revision": revision },
      Env: ["NOT_FOR_PUBLIC_REPORT=very-secret-test-only"],
    },
    RepoDigests: ["internal.example.invalid/test@" + "sha256:" + "5".repeat(64)],
    RepoTags: ["sensitive.example.invalid/private-repo:private-tag"],
  });
  return {
    current, currentApiId, currentWebId, rollbackApiId, rollbackWebId, rollbackSourceSha,
    images: [
      make(currentApiId, "api", sha), make(currentWebId, "web", sha),
      make(rollbackApiId, "api", rollbackSourceSha),
      make(rollbackWebId, "web", rollbackSourceSha),
    ],
    options: { project, sourceSha: sha, rollbackApiId, rollbackWebId, rollbackSourceSha },
  };
}

test("read-only V5 image inventory preserves self-reported versus attested provenance boundary", () => {
  const f = imageInventoryFixtures();
  const result = assessV5ImageInventory(f.current, f.images, f.options);
  assert.equal(result.status, "LOCAL_IMAGE_INVENTORY_PASS_REVIEW_REQUIRED");
  assert.equal(result.currentPairLocallyAvailableAndLabeled, true);
  assert.equal(result.rollbackPairLocallyAvailableAndLabeled, true);
  assert.equal(result.authenticatedImageProvenanceVerified, false);
  assert.equal(result.rollbackCompatibilityVerified, false);
  assert.equal(result.approvedRollbackProcedure, false);
  assert.equal(result.productionDeploymentAuthorized, false);
  assert.equal(result.changesMade, false);
  assert.deepEqual(result.current.api.registryManifestDigestsObserved,
    ["sha256:" + "5".repeat(64)]);
  assert.ok(!JSON.stringify(result).includes("very-secret-test-only"));
  assert.ok(!JSON.stringify(result).includes("sensitive.example.invalid"));
});

test("rollback identity is never guessed when previous image IDs and source are absent", () => {
  const f = imageInventoryFixtures();
  const result = assessV5ImageInventory(f.current, f.images,
    { project, sourceSha: sha });
  assert.equal(result.status, "CHECK_REQUIRED");
  assert.equal(result.rollback, null);
  assert.equal(result.rollbackPairLocallyAvailableAndLabeled, false);
  assert.equal(result.currentPairLocallyAvailableAndLabeled, true);
});

test("missing, mislabelled, wrong-role or active-image rollback candidates cannot pass", () => {
  const f = imageInventoryFixtures();
  for (const mutation of [
    x => { x.images.pop(); },
    x => { x.images[3].Config.Labels["org.opencontainers.image.revision"] = sha; },
    x => { x.images[2].Config.WorkingDir = "/app"; },
    x => { x.options.rollbackApiId = x.currentApiId; },
    x => { x.current.find(y => y.Config.Labels["com.docker.compose.service"] === "web").Image =
      "sha256:" + "9".repeat(64); },
    x => { x.current.push({ ...x.current.find(y =>
      y.Config.Labels["com.docker.compose.service"] === "api") }); },
  ]) {
    const copy = structuredClone(f);
    mutation(copy);
    const result = assessV5ImageInventory(copy.current, copy.images, copy.options);
    assert.equal(result.status, "CHECK_REQUIRED");
  }
});

test("invalid V5 project or incomplete rollback ID triple is rejected before Docker IO", () => {
  const f = imageInventoryFixtures();
  assert.throws(() => assessV5ImageInventory(f.current, f.images,
    { ...f.options, project: "bba-production" }), /INVALID_ISOLATED_TARGET_OR_SOURCE/);
  assert.throws(() => assessV5ImageInventory(f.current, f.images,
    { ...f.options, rollbackSourceSha: null }), /INCOMPLETE_PINNED_ROLLBACK_TRIPLE/);
  assert.throws(() => assessV5ImageInventory(f.current, f.images,
    { ...f.options, rollbackApiId: "rc7" }), /INCOMPLETE_PINNED_ROLLBACK_TRIPLE/);
});
