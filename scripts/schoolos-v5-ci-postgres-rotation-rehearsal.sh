#!/usr/bin/env bash
# Disposable, owner-data-free PostgreSQL password rotation acceptance rehearsal.
# Strict TCP auth (not trusted Unix-socket auth), ephemeral volume and network.
# SQL password change uses stdin; no sensitive values, hashes or raw logs shown.
set -euo pipefail

docker info >/dev/null 2>&1 || { echo "V5_PG_ROTATION_REHEARSAL=HOLD_NO_DOCKER"; exit 2; }
name="v5-postgres-rotation-rehearsal-${RANDOM}-${RANDOM}"
volume="${name}-data"
db=v5_rotation_synthetic
db_user=v5_synthetic
old="$(openssl rand -hex 32)"
new="$(openssl rand -hex 32)"
if [[ "$old" == "$new" || ${#new} -lt 32 ]]; then exit 2; fi

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm -f "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker volume create "$volume" >/dev/null
start() {
  local startup_password="$1"
  docker run -d --name "$name" \
    --network none \
    --shm-size=128m \
    -v "$volume:/var/lib/postgresql/data" \
    -e "POSTGRES_PASSWORD=$startup_password" \
    -e "POSTGRES_DB=$db" \
    -e "POSTGRES_USER=$db_user" \
    postgres:16-alpine >/dev/null

  local ready=0
  for _ in $(seq 1 40); do
    if docker exec "$name" pg_isready -h 127.0.0.1 -U "$db_user" -d "$db" >/dev/null 2>&1; then
      ready=1; break
    fi
    sleep 1
  done
  [[ "$ready" -eq 1 ]] || { echo "V5_PG_ROTATION_REHEARSAL=HOLD_START"; exit 2; }
}
run_sql() {
  local password="$1"
  local query="$2"
  printf '%s\n' "$query" | docker exec -i -e "PGPASSWORD=$password" "$name" \
    psql -X -A -t -v ON_ERROR_STOP=1 -h 127.0.0.1 -U "$db_user" -d "$db" 2>/dev/null
}
start "$old"
run_sql "$old" "CREATE TABLE v5_synthetic_rotation (k text PRIMARY KEY, v text NOT NULL);" >/dev/null
run_sql "$old" "INSERT INTO v5_synthetic_rotation VALUES ('preserved','yes');" >/dev/null
# Pass rotated password via PostgreSQL stdin, not as psql -c/argv.
printf "ALTER ROLE %s WITH PASSWORD '%s';\n" "$db_user" "$new" |
  docker exec -i -e "PGPASSWORD=$old" "$name" \
    psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -U "$db_user" -d "$db" >/dev/null 2>&1

if run_sql "$old" "SELECT 'old-auth-accepted';" >/dev/null 2>&1; then
  echo "V5_PG_ROTATION_REHEARSAL=HOLD_OLD_CREDENTIAL_ACCEPTED"
  exit 2
fi
[[ "$(run_sql "$new" "SELECT v FROM v5_synthetic_rotation WHERE k='preserved';")" == "yes" ]] ||
  { echo "V5_PG_ROTATION_REHEARSAL=HOLD_NEW_ACCESS_OR_DATA"; exit 2; }

docker stop "$name" >/dev/null
docker rm "$name" >/dev/null
# Changing POSTGRES_PASSWORD on an existing data volume does not itself change
# the role password. The previous, explicit ALTER ROLE must remain effective.
start "$new"
if run_sql "$old" "SELECT 'old-auth-accepted';" >/dev/null 2>&1; then
  echo "V5_PG_ROTATION_REHEARSAL=HOLD_OLD_CREDENTIAL_AFTER_RESTART"
  exit 2
fi
[[ "$(run_sql "$new" "SELECT v FROM v5_synthetic_rotation WHERE k='preserved';")" == "yes" ]] ||
  { echo "V5_PG_ROTATION_REHEARSAL=HOLD_RESTART_READBACK"; exit 2; }

echo "V5_POSTGRES_OLD_PASSWORD_REJECTED=PASS_SYNTHETIC"
echo "V5_POSTGRES_NEW_PASSWORD_ACCEPTED=PASS_SYNTHETIC"
echo "V5_POSTGRES_PERSISTENT_DB_READBACK=PASS_SYNTHETIC"
echo "V5_EXISTING_VOLUME_ENV_ONLY_NOT_ROTATION=VERIFIED_SYNTHETIC"
echo "V5_ACTUAL_STAGING_POSTGRES_ROTATION=NOT_EXECUTED"
echo "V5_DEPLOYMENT_AUTHORIZATION=HOLD"
