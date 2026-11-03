#!/usr/bin/env bash
set -euo pipefail

# Phase-1 #292: SYNTHETIC recovery compatibility only. Runs inside a disposable
# GitHub Actions container job. Never reaches Coolify, customer DB, R2 or VPS.
# Tests baseline source API against a DB bootstrapped by combined V5 source.
BASE_SHA="b54dca5ae36a948f83012faa4a37354198fba083"
NEW_IMAGE="schoolos-v5-ci-lf-check:ephemeral"
OLD_IMAGE="schoolos-v5-ci-backward-source:ephemeral"

if [[ "${GITHUB_ACTIONS:-}" != "true" || "${GITHUB_EVENT_NAME:-}" != "pull_request" ||
      "${GITHUB_HEAD_REF:-}" != integration/schoolos-v5-* ||
      -z "${RUNNER_TEMP:-}" || -z "${EXPECTED_SOURCE_SHA:-}" ]]; then
  echo "V5_TWO_SOURCE_RECOVERY=CI_INTEGRATION_PR_ONLY"
  exit 2
fi

if [[ ! "$EXPECTED_SOURCE_SHA" =~ ^[0-9a-f]{40}$ ||
      "$(git rev-parse HEAD)" != "$EXPECTED_SOURCE_SHA" ]]; then
  echo "V5_TWO_SOURCE_RECOVERY=SOURCE_MISMATCH"
  exit 2
fi

id="${GITHUB_RUN_ID:-0}-${GITHUB_RUN_ATTEMPT:-0}"
network="v5-ci-two-source-net-$id"
pg="v5-ci-two-source-pg-$id"
api="v5-ci-two-source-api-$id"
old_tree="$RUNNER_TEMP/schoolos-v5-two-source-$id"
made_worktree=0
made_net=0
made_pg=0
made_api=0
cleanup() {
  if [[ "$made_api" == 1 ]]; then docker rm -f "$api" >/dev/null 2>&1 || true; fi
  if [[ "$made_pg" == 1 ]]; then docker rm -f "$pg" >/dev/null 2>&1 || true; fi
  if [[ "$made_net" == 1 ]]; then docker network rm "$network" >/dev/null 2>&1 || true; fi
  if [[ "$made_worktree" == 1 ]]; then git worktree remove --force "$old_tree" >/dev/null 2>&1 || true; fi
  docker image rm "$OLD_IMAGE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# The inspected reference is a known SOURCE revision, not a signed old image.
# A clean checkout cannot contain the owner's historical Docker archives.
git fetch --no-tags --depth=1 origin "$BASE_SHA" >/dev/null 2>&1
git worktree add --detach "$old_tree" "$BASE_SHA" >/dev/null 2>&1
made_worktree=1

# Fail rather than claim 'backward schema compatibility' if Prisma differs.
if ! git diff --quiet "$BASE_SHA" HEAD -- apps/api/prisma/schema.prisma apps/api/prisma/migrations; then
  echo "V5_TWO_SOURCE_PRISMA_IDENTICAL=NO"
  exit 2
fi
echo "V5_TWO_SOURCE_PRISMA_IDENTICAL=YES"

# New image already built, metadata-scanned and API-boot-tested by this job.
docker image inspect "$NEW_IMAGE" >/dev/null 2>&1
new_label="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$NEW_IMAGE")"
if [[ "$new_label" != "$EXPECTED_SOURCE_SHA" ]]; then
  echo "V5_TWO_SOURCE_NEW_IMAGE_LABEL=CHECK_REQUIRED"
  exit 2
fi
echo "V5_TWO_SOURCE_NEW_IMAGE_LABEL=PASS"

# Rebuild older source in disposable CI. No live env, build args or archives.
DOCKER_BUILDKIT=1 docker build --pull=false \
  --build-arg "SCHOOLOS_BUILD_REVISION=$BASE_SHA" \
  --tag "$OLD_IMAGE" --file "$old_tree/apps/api/Dockerfile" "$old_tree" >/dev/null
old_label="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$OLD_IMAGE")"
if [[ "$old_label" != "$BASE_SHA" ]]; then
  echo "V5_TWO_SOURCE_OLD_IMAGE_LABEL=CHECK_REQUIRED"
  exit 2
fi
node scripts/schoolos-v5-image-secret-metadata-audit.mjs "$OLD_IMAGE"
echo "V5_TWO_SOURCE_PREVIOUS_SOURCE_BUILD=PASS_SYNTHETIC_ONLY"

docker network create --driver bridge --internal "$network" >/dev/null
made_net=1
docker run -d --rm --pull=never --name "$pg" \
  --network "$network" --network-alias pg \
  --tmpfs /var/lib/postgresql/data:rw,size=1024m \
  --memory 1400m \
  -e POSTGRES_DB=schoolos_ci -e POSTGRES_USER=schoolos_ci \
  -e POSTGRES_PASSWORD=synthetic_ci_credential_only \
  postgres:16-alpine >/dev/null
made_pg=1

ready=0
for i in $(seq 1 60); do
  if docker exec "$pg" pg_isready -U schoolos_ci -d schoolos_ci >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
if [[ "$ready" != 1 ]]; then
  echo "V5_TWO_SOURCE_POSTGRES=CHECK_REQUIRED"
  exit 2
fi
echo "V5_TWO_SOURCE_POSTGRES=PASS_DISPOSABLE"

start_api() {
  local image="$1"
  docker run -d --rm --pull=never --name "$api" \
    --network "$network" --network-alias api \
    --memory 2300m --pids-limit 1024 \
    -e NODE_ENV=test -e PORT=4000 \
    -e DATABASE_URL=postgresql://schoolos_ci:synthetic_ci_credential_only@pg:5432/schoolos_ci?schema=public \
    -e JWT_ACCESS_SECRET=synthetic-ci-only-access-token-secret-32-chars \
    -e JWT_REFRESH_SECRET=synthetic-ci-only-refresh-token-secret-32-chars \
    -e WEB_URL=http://web:3000 -e STORAGE_DRIVER=local \
    -e LOCAL_STORAGE_PATH=/data/storage -e REDIS_REQUIRED=false \
    -e LOG_LEVEL=silent -e RAZORPAY_MODE=test \
    "$image" >/dev/null
  made_api=1
  local ok=0
  for i in $(seq 1 105); do
    if docker exec "$api" node -e 'fetch("http://127.0.0.1:4000/health/ready",{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; then
      ok=1
      break
    fi
    if ! docker inspect "$api" --format '{{.State.Running}}' 2>/dev/null | grep -qx true; then
      break
    fi
    sleep 2
  done
  if [[ "$ok" != 1 ]]; then
    echo "V5_TWO_SOURCE_API_BOOT=CHECK_REQUIRED"
    exit 2
  fi
}
stop_api() {
  docker rm -f "$api" >/dev/null 2>&1
  made_api=0
}

# Migrate with candidate source, switch to the previous source, then roll forward.
start_api "$NEW_IMAGE"
count="$(docker exec "$pg" psql -U schoolos_ci -d schoolos_ci -At -c 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL' 2>/dev/null)"
if [[ ! "$count" =~ ^[0-9]+$ ]] || (( count < 114 )); then
  echo "V5_TWO_SOURCE_MIGRATIONS=CHECK_REQUIRED"
  exit 2
fi
echo "V5_TWO_SOURCE_NEW_API_INITIAL_BOOT=PASS"
stop_api

start_api "$OLD_IMAGE"
echo "V5_TWO_SOURCE_PREVIOUS_API_BACKWARD_BOOT=PASS"
stop_api

start_api "$NEW_IMAGE"
echo "V5_TWO_SOURCE_FORWARD_API_REBOOT=PASS"
stop_api

echo "V5_TWO_SOURCE_BACKWARD_FORWARD_SMOKE=PASS_SYNTHETIC_EMPTY_DATABASE"
echo "REAL_STAGING_DATA_AND_IMAGES_ACCESSED=NO"
echo "REAL_DATABASE_BACKWARD_COMPATIBILITY=NOT_ATTESTED"
echo "SIGNED_RETRIEVABLE_ROLLBACK=NOT_ATTESTED"
echo "STAGING_PRODUCTION_CHANGED=NO"
echo "COMMERCIAL_GO=HOLD"
