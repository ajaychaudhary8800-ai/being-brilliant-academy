#!/usr/bin/env bash
set -euo pipefail
# Exercise the actual newly built V5 Web runtime without staging credentials.
# No network, no persistent volume, no image pull, no real API/database.
if [[ "${GITHUB_ACTIONS:-}" != "true" ]]; then
  echo "V5_WEB_SMOKE=CI_ONLY"
  exit 2
fi
name="schoolos-v5-ci-web-${GITHUB_RUN_ID:-0}-${GITHUB_RUN_ATTEMPT:-0}"
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --rm --pull=never --name "$name" \
  --network none --read-only --tmpfs /tmp:rw,size=128m \
  --cap-drop ALL --security-opt no-new-privileges \
  --memory 1200m --pids-limit 256 \
  -e NODE_ENV=production \
  -e HOSTNAME=127.0.0.1 \
  -e PORT=3000 \
  bba-web:local >/dev/null

ready=0
for attempt in $(seq 1 50); do
  if docker exec "$name" node -e 'fetch("http://127.0.0.1:3000/api/health", {signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! docker inspect "$name" --format '{{.State.Running}}' 2>/dev/null | grep -qx true; then
    break
  fi
  sleep 2
done

if [[ "$ready" -ne 1 ]]; then
  echo "V5_WEB_RUNTIME_HEALTH=CHECK_REQUIRED"
  echo "V5_STAGING_PRODUCTION_CHANGED=NO"
  exit 2
fi
echo "V5_WEB_RUNTIME_HEALTH=PASS_ISOLATED_NO_NETWORK"
echo "V5_WEB_REAL_STAGING_DATA=NOT_ACCESSED"
echo "V5_IMAGE_IMMUTABLE_REGISTRY_PROVENANCE=NOT_ATTESTED"
echo "V5_DATABASE_BACKWARD_COMPATIBILITY=NOT_TESTED"
echo "V5_STAGING_PRODUCTION_CHANGED=NO"
echo "V5_DEPLOYMENT_AUTHORIZATION=HOLD"
