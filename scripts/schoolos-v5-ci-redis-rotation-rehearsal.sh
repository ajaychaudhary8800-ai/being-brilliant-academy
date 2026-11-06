#!/usr/bin/env bash
# Disposable local Docker-only Redis AUTH/ACL rehearsal. Never contact V5
# staging/production, print passwords/hashes, or modify persistent live volumes.
set -euo pipefail

docker info >/dev/null 2>&1 || { echo "V5_REDIS_REHEARSAL=HOLD_NO_DOCKER"; exit 2; }
image="schoolos-v5-redis-auth-rehearsal:ci"
name="v5-redis-rotation-rehearsal-${RANDOM}-${RANDOM}"
volume="${name}-data"
old="$(openssl rand -hex 32)"
new="$(openssl rand -hex 32)"
if [[ "$old" == "$new" || ${#new} -lt 32 ]]; then exit 2; fi

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm -f "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker build --quiet -f infra/redis/Dockerfile -t "$image" . >/dev/null
docker volume create "$volume" >/dev/null

start() {
  local password="$1"
  docker run --name "$name" -d \
    --network none \
    --tmpfs /run/schoolos-v5-redis-auth:rw,noexec,nosuid,nodev,size=64k \
    -e "REDIS_PASSWORD=$password" \
    -v "$volume:/data" \
    "$image" >/dev/null
  local healthy=0
  for _ in $(seq 1 30); do
    if docker exec -e "REDISCLI_AUTH=$password" "$name" redis-cli --no-auth-warning ping 2>/dev/null | grep -qx PONG; then
      healthy=1; break
    fi
    sleep 1
  done
  [[ "$healthy" -eq 1 ]] || { echo "V5_REDIS_REHEARSAL=HOLD_START"; exit 2; }
  # Assertions inspect only password-free command metadata and processes;
  # never print docker inspect, env, mounted ACL bytes, or command line.
  local cmdline
  cmdline="$(docker exec "$name" sh -c 'tr "\\000" " " </proc/1/cmdline')"
  [[ "$cmdline" != *"$password"* && "$cmdline" != *"requirepass"* ]] ||
    { echo "V5_REDIS_REHEARSAL=HOLD_PLAINTEXT_ARGV"; exit 2; }
}
start "$old"
docker exec -e "REDISCLI_AUTH=$old" "$name" redis-cli --no-auth-warning SET v5-ci-rotation-preserved synthetic-ok >/dev/null

docker stop "$name" >/dev/null
docker rm "$name" >/dev/null
start "$new"
# redis-cli may exit zero even after a Redis-level WRONGPASS/NOAUTH error,
# so negative acceptance checks require an actual PONG, not exit code alone.
if docker exec -e "REDISCLI_AUTH=$old" "$name" redis-cli --no-auth-warning ping 2>/dev/null | grep -qx PONG; then
  echo "V5_REDIS_REHEARSAL=HOLD_OLD_CREDENTIAL_ACCEPTED"
  exit 2
fi
if docker exec "$name" redis-cli --no-auth-warning ping 2>/dev/null | grep -qx PONG; then
  echo "V5_REDIS_REHEARSAL=HOLD_NO_AUTH_REQUIRED"
  exit 2
fi
docker exec -e "REDISCLI_AUTH=$new" "$name" redis-cli --no-auth-warning ping | grep -qx PONG
docker exec -e "REDISCLI_AUTH=$new" "$name" redis-cli --no-auth-warning GET v5-ci-rotation-preserved | grep -qx synthetic-ok

echo "V5_REDIS_ACL_TMPFS_NO_PASSWORD_IN_ARGV=PASS_SYNTHETIC"
echo "V5_REDIS_OLD_PASSWORD_REJECTED=PASS_SYNTHETIC"
echo "V5_REDIS_NEW_PASSWORD_ACCEPTED=PASS_SYNTHETIC"
echo "V5_REDIS_PERSISTENT_DATA_READBACK=PASS_SYNTHETIC"
echo "V5_ACTUAL_STAGING_PASSWORD_ROTATION=NOT_EXECUTED"
echo "V5_REAL_ROLLBACK_COMPATIBILITY=NOT_VERIFIED"
echo "V5_DEPLOYMENT_AUTHORIZATION=HOLD"
