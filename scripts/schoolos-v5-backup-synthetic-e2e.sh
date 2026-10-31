#!/usr/bin/env bash
# CI-only: prove an actual rebuilt backup image can dump/restore synthetic
# PostgreSQL + files after relocating a historical absolute-path manifest.
# No real staging, production, payment, Vault or customer data is accessed.
set -euo pipefail
fail() {
  printf 'V5_BACKUP_IMAGE_SYNTHETIC_RECOVERY=FAIL_%s\n' "$1"
  exit 1
}
[[ "${CI:-}" == "true" && "${GITHUB_ACTIONS:-}" == "true" &&
   "${BBA_SYNTHETIC_BUILD:-}" == "true" ]] || fail "DISPOSABLE_CI_REQUIRED"
endpoint="$(docker context inspect default --format '{{.Endpoints.docker.Host}}' 2>/dev/null)" ||
  fail "DOCKER_CONTEXT_READ"
[[ "$endpoint" == "unix:///var/run/docker.sock" || "$endpoint" == "unix:///run/docker.sock" ]] ||
  fail "DOCKER_UNIX_CI_REQUIRED"
[[ "$(docker info --format '{{.OSType}}' 2>/dev/null)" == "linux" ]] ||
  fail "DOCKER_LINUX_REQUIRED"
[[ "${GITHUB_RUN_ID:-}" =~ ^[0-9]{1,30}$ &&
   "${GITHUB_RUN_ATTEMPT:-}" =~ ^[0-9]{1,10}$ ]] || fail "CI_UNIQUE_ID_REQUIRED"
sid="${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
network="v5-backup-restore-ci-net-${sid}"
pg="v5-backup-restore-ci-pg-${sid}"
backup="v5-backup-restore-ci-tool-${sid}"
tag="v5-backup-restore-ci:ephemeral"
network_created=0
pg_created=0
backup_created=0
cleanup() {
  status=$?
  trap - EXIT
  cleanup_failed=0
  if (( backup_created )); then
    docker rm -f "$backup" >/dev/null 2>&1 || cleanup_failed=1
  fi
  if (( pg_created )); then
    docker rm -f "$pg" >/dev/null 2>&1 || cleanup_failed=1
  fi
  if (( network_created )); then
    docker network rm "$network" >/dev/null 2>&1 || cleanup_failed=1
  fi
  if (( cleanup_failed )); then
    printf 'V5_BACKUP_IMAGE_SYNTHETIC_CLEANUP=CHECK_REQUIRED\n'
    exit 1
  fi
  printf 'V5_BACKUP_IMAGE_SYNTHETIC_CLEANUP=PASS\n'
  exit "$status"
}
trap cleanup EXIT
docker image inspect "$tag" >/dev/null 2>&1 || fail "IMAGE_NOT_BUILT"
for script in backup.sh restore.sh entrypoint.sh healthcheck.sh verify-checksums.sh; do
  docker run --rm --pull=never --network none --read-only \
    --cap-drop ALL --security-opt no-new-privileges \
    --entrypoint /bin/sh "$tag" -n "/usr/local/bin/$script" \
    >/dev/null 2>&1 || fail "EXECUTABLE_SYNTAX"
done
echo "V5_BACKUP_IMAGE_EXECUTABLES=PASS"
docker network create --internal --driver bridge "$network" >/dev/null ||
  fail "NETWORK_CREATE"
network_created=1
docker run -d --rm --pull=never \
  --name "$pg" --network "$network" --network-alias pg \
  --tmpfs /var/lib/postgresql/data:rw,size=1024m --memory 1400m \
  -e POSTGRES_DB=ci_restore -e POSTGRES_USER=ci_restore \
  -e POSTGRES_PASSWORD=synthetic-ci-only \
  postgres:16-alpine >/dev/null || fail "SYNTHETIC_PG_CREATE"
pg_created=1
ready=0
for attempt in $(seq 1 60); do
  if docker exec "$pg" pg_isready -U ci_restore -d ci_restore >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
[[ "$ready" == 1 ]] || fail "SYNTHETIC_PG_READY"
echo "V5_BACKUP_IMAGE_SYNTHETIC_POSTGRES=PASS"
docker run -d --rm --pull=never \
  --name "$backup" --network "$network" --memory 700m --pids-limit 128 \
  -e DATABASE_URL='postgresql://ci_restore:synthetic-ci-only@pg:5432/ci_restore?schema=public' \
  -e BACKUP_RETENTION_DAYS=14 -e AWS_S3_BUCKET='' \
  --entrypoint /bin/sh "$tag" -c 'sleep 420' >/dev/null ||
  fail "SYNTHETIC_BACKUP_TOOL_CREATE"
backup_created=1
docker exec "$backup" mkdir -p /data/storage /backups /recovery-copy ||
  fail "SYNTHETIC_FIXTURE_DIR"
docker exec "$backup" psql \
  'postgresql://ci_restore:synthetic-ci-only@pg:5432/ci_restore' \
  -v ON_ERROR_STOP=1 -q -c \
  "CREATE TABLE schoolos_restore_fixture (id integer PRIMARY KEY, payload text NOT NULL); INSERT INTO schoolos_restore_fixture (id, payload) VALUES (1, 'original_synthetic');" \
  >/dev/null 2>&1 || fail "SYNTHETIC_FIXTURE_DB"
docker exec "$backup" /bin/sh -c \
  'printf "%s\n" original_synthetic > /data/storage/synthetic-checkpoint.txt' \
  >/dev/null 2>&1 || fail "SYNTHETIC_FIXTURE_FILE"
docker exec "$backup" /usr/local/bin/backup.sh >/dev/null 2>&1 ||
  fail "SYNTHETIC_BACKUP_DUMP"
stamp="$(docker exec "$backup" cat /backups/.last-success 2>/dev/null | tr -d '\r\n')" ||
  fail "SYNTHETIC_BACKUP_STAMP"
[[ "$stamp" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || fail "UNEXPECTED_BACKUP_STAMP"
docker exec "$backup" mv "/backups/$stamp" /recovery-copy/checkpoint ||
  fail "SYNTHETIC_RELOCATE"
docker exec "$backup" /usr/local/bin/verify-checksums.sh \
  /recovery-copy/checkpoint >/dev/null 2>&1 || fail "RELOCATED_CHECKSUMS"
echo "V5_BACKUP_IMAGE_RELOCATED_CHECKSUMS=PASS"
docker exec "$backup" psql \
  'postgresql://ci_restore:synthetic-ci-only@pg:5432/ci_restore' \
  -v ON_ERROR_STOP=1 -q -c \
  "UPDATE schoolos_restore_fixture SET payload = 'changed_synthetic' WHERE id = 1;" \
  >/dev/null 2>&1 || fail "SYNTHETIC_MUTATE_DB"
docker exec "$backup" /bin/sh -c \
  'printf "%s\n" changed_synthetic > /data/storage/synthetic-checkpoint.txt' \
  >/dev/null 2>&1 || fail "SYNTHETIC_MUTATE_FILE"
docker exec "$backup" /usr/local/bin/restore.sh \
  /recovery-copy/checkpoint >/dev/null 2>&1 || fail "SYNTHETIC_RESTORE_EXECUTE"
actual_db="$(docker exec "$backup" psql \
  'postgresql://ci_restore:synthetic-ci-only@pg:5432/ci_restore' \
  -v ON_ERROR_STOP=1 -At -c \
  'SELECT payload FROM schoolos_restore_fixture WHERE id = 1' 2>/dev/null)" ||
  fail "SYNTHETIC_RESTORE_READBACK_DB"
[[ "$actual_db" == "original_synthetic" ]] || fail "SYNTHETIC_RESTORE_DB_MISMATCH"
actual_file="$(docker exec "$backup" cat /data/storage/synthetic-checkpoint.txt 2>/dev/null)" ||
  fail "SYNTHETIC_RESTORE_READBACK_FILE"
[[ "$actual_file" == "original_synthetic" ]] || fail "SYNTHETIC_RESTORE_FILE_MISMATCH"
echo "V5_BACKUP_IMAGE_RELOCATED_DB_AND_FILE_RESTORE=PASS"
docker exec "$backup" /bin/sh -c \
  'printf tampered >> /recovery-copy/checkpoint/files.tar.gz' \
  >/dev/null 2>&1 || fail "SYNTHETIC_TAMPER_SETUP"
if docker exec "$backup" /usr/local/bin/verify-checksums.sh \
  /recovery-copy/checkpoint >/dev/null 2>&1; then
  fail "TAMPER_NOT_REJECTED"
fi
echo "V5_BACKUP_IMAGE_TAMPER_REJECTION=PASS"
echo "V5_BACKUP_IMAGE_SYNTHETIC_RECOVERY=PASS"
echo "CUSTOMER_CHECKPOINT_ACCESSED=NO"
echo "VAULT_AND_MEDIA_RECOVERY=NOT_TESTED"
echo "INDEPENDENT_SOURCE_ARTIFACT_PROVENANCE=NOT_ATTESTED"
echo "STAGING_AND_PRODUCTION_CHANGED=NO"
echo "DEPLOYMENT_AUTHORIZATION=HOLD"
