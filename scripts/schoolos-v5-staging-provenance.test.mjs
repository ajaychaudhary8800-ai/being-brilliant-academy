import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { approvedStagingProject, inspectV5StagingContainers } from "./schoolos-v5-staging-provenance.mjs";

const sha = "a".repeat(40);
const project = "96ffcu0jinuwlnaqxpltln4p";
const names = ["postgres", "redis", "api", "web", "nginx", "backup"];
function container(service) {
  const env = service === "api"
    ? ["DATABASE_URL=postgresql://secret-user:secret-pass@postgres:5432/schoolos_v5_staging",
      "WEB_URL=https://v5-staging.beingbrilliantedu.com", "RAZORPAY_MODE=test"]
    : [];
  const mounts = service === "api"
    ? [{ Destination: "/run/secrets/schoolos-v5-razorpay-api.env", RW: false }]
    : service === "backup"
      ? [{ Destination: "/run/secrets/schoolos-v5-r2-credentials", RW: false }]
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
    Mounts: mounts,
  };
}
const fixtures = () => names.map(container);
const check = list => inspectV5StagingContainers(list, { project, sourceSha: sha });

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
