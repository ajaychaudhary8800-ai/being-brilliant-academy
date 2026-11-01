#!/usr/bin/env bash
# Disposable CI-only proof of pg_restore schema-only + five selected tables.
# No real backup/customer bytes or external provider credentials.
set -euo pipefail

fail() { echo "VAULT_MEDIA_CI_SELECTED_TABLE_RESTORE=FAIL_$1"; exit 1; }
[[ "${CI:-}" == "true" && "${GITHUB_ACTIONS:-}" == "true" &&
   "${BBA_SYNTHETIC_BUILD:-}" == "true" ]] || fail "NON_CI_CONTEXT"

host="$(docker context inspect default --format '{{.Endpoints.docker.Host}}' 2>/dev/null)" ||
  fail "DOCKER_CONTEXT"
[[ "$host" == "unix:///var/run/docker.sock" ||
   "$host" == "unix:///run/docker.sock" ]] || fail "REMOTE_DOCKER"

[[ "${GITHUB_RUN_ID:-}" =~ ^[0-9]{1,30}$ ]] || fail "RUN_ID"
name="v5-vaultscope-ci-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT:-1}"
created=0
cleanup(){
  status=$?
  trap - EXIT
  if (( created )); then
    docker rm -f "$name" >/dev/null 2>&1 || {
      echo "VAULT_MEDIA_CI_CLEANUP=CHECK_REQUIRED"
      exit 1
    }
  fi
  echo "VAULT_MEDIA_CI_CLEANUP=PASS"
  exit "$status"
}
trap cleanup EXIT

docker image inspect postgres:16-alpine >/dev/null 2>&1 ||
  fail "CACHED_POSTGRES_REQUIRED"
docker run --rm -d --pull=never --name "$name" \
  --network none --read-only --security-opt no-new-privileges \
  --pids-limit 512 --memory 2g \
  --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=1024m \
  --tmpfs /var/run/postgresql:rw,nosuid,nodev,size=64m \
  --tmpfs /tmp:rw,nosuid,nodev,size=128m \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=synthetic-no-secret \
  -e POSTGRES_DB=ci_scope postgres:16-alpine >/dev/null ||
  fail "PG_START"
created=1
ready=0
for i in $(seq 1 60); do
  if docker exec --user postgres "$name" pg_isready -U postgres -d ci_scope >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
[[ "$ready" == 1 ]] || fail "PG_READY"

sql='
CREATE TYPE "ScopeStatus" AS ENUM (''READY'',''STOPPED'');
CREATE TABLE "SaaSCommercialDocument" ("id" integer PRIMARY KEY, "encryptedFileData" bytea NOT NULL);
CREATE TABLE "LiveClass" ("id" integer PRIMARY KEY, "recordingObjectKey" text, "state" "ScopeStatus");
CREATE TABLE "StudyMaterial" ("id" integer PRIMARY KEY, "storageKey" text);
CREATE TABLE "MeetingRecording" ("id" integer PRIMARY KEY, "storageKey" text);
CREATE TABLE "MeetingAttachment" ("id" integer PRIMARY KEY, "storageKey" text);
CREATE TABLE "OtherConfidential" ("id" integer PRIMARY KEY, "privatePayload" text NOT NULL);
INSERT INTO "SaaSCommercialDocument" VALUES (1,decode(''4344563101020304'',''hex''));
INSERT INTO "LiveClass" VALUES (1,''synthetic-key'',''READY'');
INSERT INTO "StudyMaterial" VALUES (1,''synthetic-key'');
INSERT INTO "MeetingRecording" VALUES (1,''synthetic-key'');
INSERT INTO "MeetingAttachment" VALUES (1,''synthetic-key'');
INSERT INTO "OtherConfidential" VALUES (1,''do-not-select'');
'
# Quote-safe SQL: no real secrets or data involved.
docker exec --user postgres "$name" psql -X -v ON_ERROR_STOP=1 -U postgres \
  -d ci_scope -q -c "$sql" >/dev/null 2>&1 || fail "SYNTHETIC_SCHEMA"
docker exec --user postgres "$name" pg_dump -U postgres -d ci_scope \
  --format=custom --file=/tmp/ci-scope.dump >/dev/null 2>&1 || fail "DUMP"
docker exec --user postgres "$name" createdb -U postgres ci_scope_target \
  >/dev/null 2>&1 || fail "TARGET_DB"
docker exec --user postgres "$name" pg_restore -U postgres -d ci_scope_target \
  --section=pre-data --no-owner --no-acl --exit-on-error \
  --single-transaction /tmp/ci-scope.dump >/dev/null 2>&1 || fail "PREDATA"
echo "VAULT_MEDIA_CI_ENUM_DEPENDENCIES=PASS"

for table in SaaSCommercialDocument LiveClass StudyMaterial MeetingRecording MeetingAttachment; do
  docker exec --user postgres "$name" pg_restore -U postgres -d ci_scope_target \
    --data-only "--table=$table" --no-owner --no-acl \
    --exit-on-error --single-transaction /tmp/ci-scope.dump \
    >/dev/null 2>&1 || fail "SELECTED_TABLE_DATA"
done
echo "VAULT_MEDIA_CI_SELECTED_DATA_LOAD=PASS"

read_count(){
  docker exec --user postgres "$name" psql -U postgres -d ci_scope_target \
    -At -c "$1" 2>/dev/null
}
for table in SaaSCommercialDocument LiveClass StudyMaterial MeetingRecording MeetingAttachment; do
  [[ "$(read_count "select count(*) from \"$table\"")" == "1" ]] ||
    fail "SELECTED_TABLE_COUNT"
done
[[ "$(read_count 'select count(*) from "OtherConfidential"')" == "0" ]] ||
  fail "NON_ALLOWLIST_TABLE_LOADED"
echo "VAULT_MEDIA_CI_UNSELECTED_DATA_EXCLUDED=PASS"
echo "VAULT_MEDIA_CI_SELECTED_TABLE_RESTORE=PASS"
echo "CUSTOMER_DATA_ACCESSED=NO"
echo "VAULT_KEY_AND_MEDIA_OBJECT_ACCESSED=NO"
echo "STAGING_AND_PRODUCTION_CHANGED=NO"
