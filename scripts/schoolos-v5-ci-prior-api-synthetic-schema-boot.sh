#!/usr/bin/env bash
set -euo pipefail
# EXACT OLD-SOURCE API BINARY: CURRENT->PRIOR->CURRENT schema-boot rehearsal.
# Only disposable CI Postgres, isolated network and synthetic data.
# Container overlay writes are ephemeral and removed by cleanup; no host mounts.
# No deploy, secret retrieval, provider call, image publication or registry push.
if [[ "${GITHUB_ACTIONS:-}" != "true" || -z "${GITHUB_RUN_ID:-}" ]]; then
  echo "V5_PRIOR_SCHEMA_BOOT=CI_ONLY"
  exit 2
fi
for target in schoolos-candidate-api:ci schoolos-previous-api-docs-reviewed:ci; do
  docker image inspect "$target" >/dev/null
done

key="v5-prior-compat-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT:-1}"
net="${key}-isolated-net"
db="${key}-pg"
api="${key}-api"
network_created=0
db_created=0
api_created=0
cleanup() {
  if (( api_created )); then docker rm -f "$api" >/dev/null 2>&1 || true; fi
  if (( db_created )); then docker rm -f "$db" >/dev/null 2>&1 || true; fi
  if (( network_created )); then docker network rm "$net" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

docker network create --internal "$net" >/dev/null
network_created=1
docker run -d --rm --pull=missing --name "$db" --network "$net" \
  --network-alias pg --memory 1400m --pids-limit 512 \
  --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=1024m \
  -e POSTGRES_DB=schoolos_synthetic \
  -e POSTGRES_USER=schoolos_synthetic \
  -e POSTGRES_PASSWORD=synthetic_ci_credential_only \
  postgres:16-alpine >/dev/null
db_created=1
pg_ready=0
for _ in $(seq 1 60); do
  if docker exec "$db" pg_isready -U schoolos_synthetic -d schoolos_synthetic >/dev/null 2>&1; then
    pg_ready=1
    break
  fi
  sleep 2
done
if [[ "$pg_ready" != 1 ]]; then
  echo "V5_PRIOR_SYNTHETIC_DB=FAIL"
  exit 2
fi
echo "V5_PRIOR_SYNTHETIC_DB=PASS"

start_api() {
  local source="$1"
  docker run -d --rm --pull=never --name "$api" --network "$net" \
    --network-alias api --memory 2300m --pids-limit 1024 \
    --cap-drop ALL --security-opt no-new-privileges \
    --tmpfs /data/storage:rw,nosuid,nodev,size=128m \
    --tmpfs /tmp:rw,nosuid,nodev,size=128m \
    -e NODE_ENV=test -e PORT=4000 \
    -e DATABASE_URL=postgresql://schoolos_synthetic:synthetic_ci_credential_only@pg:5432/schoolos_synthetic?schema=public \
    -e JWT_ACCESS_SECRET=synthetic-ci-only-access-token-secret-32-chars \
    -e JWT_REFRESH_SECRET=synthetic-ci-only-refresh-token-secret-32-chars \
    -e WEB_URL=http://web:3000 -e STORAGE_DRIVER=local \
    -e LOCAL_STORAGE_PATH=/data/storage \
    -e REDIS_REQUIRED=false -e LOG_LEVEL=silent -e RAZORPAY_MODE=test \
    "$source" >/dev/null
  api_created=1
  local ready=0
  for _ in $(seq 1 105); do
    if docker exec "$api" node -e 'fetch("http://127.0.0.1:4000/health/ready",{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; then
      ready=1
      break
    fi
    if ! docker inspect "$api" --format '{{.State.Running}}' 2>/dev/null | grep -qx true; then
      break
    fi
    sleep 2
  done
  if [[ "$ready" != 1 ]]; then
    echo "V5_PRIOR_API_BOOT=CHECK_REQUIRED"
    exit 2
  fi
}
stop_api() {
  docker rm -f "$api" >/dev/null
  api_created=0
}

start_api schoolos-candidate-api:ci
migrations="$(docker exec "$db" psql -U schoolos_synthetic -d schoolos_synthetic -At \
  -c 'SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL' 2>/dev/null)"
if ! [[ "$migrations" =~ ^[0-9]+$ ]] || (( migrations < 114 )); then
  echo "V5_PRIOR_CURRENT_SCHEMA=CHECK_REQUIRED"
  exit 2
fi
# Independent synthetic marker outside application tables. Never call this a
# business data or backwards migration-compatibility acceptance test.
docker exec "$db" psql -U schoolos_synthetic -d schoolos_synthetic \
  -v ON_ERROR_STOP=1 -q \
  -c "CREATE TABLE public.schoolos_synthetic_compat_marker (id integer PRIMARY KEY)" \
  -c "INSERT INTO public.schoolos_synthetic_compat_marker (id) VALUES (17)" >/dev/null
echo "V5_PRIOR_CURRENT_SCHEMA_MIGRATIONS=PASS"
stop_api
start_api schoolos-previous-api-docs-reviewed:ci
marker="$(docker exec "$db" psql -U schoolos_synthetic -d schoolos_synthetic -At \
  -c 'SELECT count(*) FROM public.schoolos_synthetic_compat_marker WHERE id = 17' 2>/dev/null)"
if [[ "$marker" != 1 ]]; then
  echo "V5_PRIOR_SYNTHETIC_NONEMPTY_PERSISTENCE=FAIL"
  exit 2
fi
echo "V5_PRIOR_OLDER_API_CURRENT_SCHEMA_BOOT=PASS_SYNTHETIC_ONLY"
stop_api
start_api schoolos-candidate-api:ci
echo "V5_PRIOR_REFORWARD_APP_BOOT=PASS_SYNTHETIC_ONLY"
echo "V5_PRIOR_SYNTHETIC_MARKER_PRESERVED=PASS"
echo "V5_PRIOR_CUSTOMER_DATA_COMPATIBILITY=NOT_TESTED"
echo "V5_PRIOR_SCHEMA_DOWNGRADE_ATTEMPTED=NO"
echo "V5_PRIOR_ARCHIVE_RESTORE_USED=NO"
echo "V5_PRIOR_SIGNED_IMMUTABLE_ROLLBACK=NOT_CREATED"
echo "V5_PRIOR_STAGING_PRODUCTION_CHANGED=NO"
echo "V5_PHASE1_DEPLOYMENT_AUTHORIZATION=HOLD"
