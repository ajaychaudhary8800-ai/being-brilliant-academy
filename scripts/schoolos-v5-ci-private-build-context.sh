#!/usr/bin/env bash
set -euo pipefail

# CI-only disposable fixture names. No real customer data, keys or archives.
# This proves Docker build context exclusions, which .gitignore cannot prove.
if [[ "${GITHUB_ACTIONS:-}" != "true" ]]; then
  echo "V5_CONTEXT_GUARD=CI_ONLY"
  exit 2
fi
if [[ -e SchoolOS-V5-Recovery-0123456789abcdef0123456789abcdef ]]; then
  echo "V5_CONTEXT_GUARD=UNEXPECTED_EXISTING_FIXTURE"
  exit 2
fi
fixture="SchoolOS-V5-Recovery-0123456789abcdef0123456789abcdef"
image="v5-ci-private-build-context:ephemeral"
container="v5-ci-private-context-${GITHUB_RUN_ID:-0}-${GITHUB_RUN_ATTEMPT:-0}"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker image rm "$image" >/dev/null 2>&1 || true
  rm -rf -- "$fixture"
  rm -f -- context-private-ci.dpapi context-private-ci.dump \
    context-private-ci.docker-save.tar context-private-ci.oci-archive.tar \
    .env.schoolos-ci-private
}
trap cleanup EXIT
mkdir "$fixture"
printf 'DISPOSABLE ONLY\n' > "$fixture/private-fixture.txt"
for file in context-private-ci.dpapi context-private-ci.dump \
  context-private-ci.docker-save.tar context-private-ci.oci-archive.tar \
  .env.schoolos-ci-private; do
  if [[ -e "$file" ]]; then echo "V5_CONTEXT_GUARD=UNEXPECTED_EXISTING_FIXTURE"; exit 2; fi
  printf 'DISPOSABLE ONLY\n' > "$file"
done

# Scratch image contains only the local build context after .dockerignore.
# The container is CREATED, never started; no network, no VPS, no production.
DOCKER_BUILDKIT=1 docker build --pull=false --no-cache --quiet \
  --tag "$image" -f - . <<'DOCKERFILE' >/dev/null
FROM scratch
COPY . /context
DOCKERFILE

docker create --name "$container" "$image" /not-executed >/dev/null

# Check presence via docker cp exit status, never read any file content.
if ! docker cp "$container:/context/package.json" - >/dev/null 2>&1; then
  echo "V5_CONTEXT_GUARD=CHECK_REQUIRED_NORMAL_SOURCE_MISSING"
  exit 2
fi
for file in \
  "$fixture/private-fixture.txt" \
  context-private-ci.dpapi \
  context-private-ci.dump \
  context-private-ci.docker-save.tar \
  context-private-ci.oci-archive.tar \
  .env.schoolos-ci-private; do
  if docker cp "$container:/context/$file" - >/dev/null 2>&1; then
    echo "V5_CONTEXT_GUARD=FAIL_PRIVATE_CONTENT_INCLUDED"
    exit 2
  fi
done
echo "V5_CONTEXT_GUARD=PASS_EXCLUDED_PRIVATE_FIXTURES"
echo "V5_CONTEXT_PRIVATE_CONTENT_PRINTED=NO"
echo "V5_STAGING_PRODUCTION_CHANGED=NO"
echo "V5_COMMERCIAL_GO=HOLD"
