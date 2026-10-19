#!/usr/bin/env bash
# Isolated synthetic V4 -> V5 migration and round-trip recovery drill.
# NEVER accepts a production database target or touches a remote server.
set -euo pipefail

if [[ "${GITHUB_ACTIONS:-}" != "true" || "${PGHOST:-}" != "127.0.0.1" || "${PGPORT:-}" != "5432" ]]; then
  echo "REFUSED: V5 upgrade rehearsal requires GitHub-hosted CI and local PostgreSQL on 127.0.0.1:5432" >&2
  exit 78
fi
if [[ "${PGUSER:-}" != "postgres" || "${PGDATABASE:-}" != "postgres" ]]; then
  echo "REFUSED: local synthetic PostgreSQL test account expected" >&2
  exit 78
fi
if [[ "${SCHOOLOS_V4_BASE_SHA:-}" != "50dfdeb4f99c5cdbaf1d5a9502c709fbbf2798f6" ]]; then
  echo "REFUSED: pinned frozen V4 baseline mismatched" >&2
  exit 78
fi
for cmd in git pnpm psql createdb pg_dump pg_restore sha256sum node; do
  command -v "$cmd" >/dev/null || { echo "Missing tool: $cmd" >&2; exit 78; }
done
source_db="bba_v4_rehearsal_test"
upgrade_db="bba_v5_rehearsal_test"
restored_db="bba_v5_restored_test"
for db in "$source_db" "$upgrade_db" "$restored_db"; do
  if psql -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q '^1$'; then
    echo "REFUSED: isolated test database already exists: $db" >&2
    exit 78
  fi
done
root="$(git rev-parse --show-toplevel)"
base_dir="$(mktemp -d)"
trap 'git -C "$root" worktree remove --force "$base_dir/v4" >/dev/null 2>&1 || true' EXIT
echo "Isolated V4 -> V5 migration acceptance using frozen baseline $SCHOOLOS_V4_BASE_SHA"
git -C "$root" worktree add --detach "$base_dir/v4" "$SCHOOLOS_V4_BASE_SHA"
for db in "$source_db" "$upgrade_db" "$restored_db"; do
  createdb "$db"
done
conn() { printf "postgresql://postgres:postgres@127.0.0.1:5432/%s?schema=public" "$1"; }

# Apply only the frozen V4 migrations using the pinned historical schema.
DATABASE_URL="$(conn "$source_db")" pnpm --filter @bba/api exec prisma migrate deploy \
 --schema "$base_dir/v4/apps/api/prisma/schema.prisma"
baseline_migrations="$(psql -d "$source_db" -Atqc 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')"
if [[ ! "$baseline_migrations" =~ ^[0-9]+$ || "$baseline_migrations" -lt 50 ]]; then
  echo "FAIL: frozen V4 migrations did not apply" >&2
  exit 1
fi
echo "V4 completed migration count: $baseline_migrations"

# Minimal synthetic customer and staff identity, never copied from production.
psql -d "$source_db" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO "Organization" ("id","slug","name","email")
VALUES ('qa-v5-upgrade-test-org','qa-v5-upgrade-test',
        'Synthetic V4-to-V5 Upgrade Institution','synthetic-v5-upgrade@example.test');
INSERT INTO "User" ("id","organizationId","email","passwordHash","name","role")
VALUES ('qa-v5-upgrade-test-user','qa-v5-upgrade-test-org',
        'qa-v5-upgrade-user@example.test','disabled-synthetic-test-hash',
        'Synthetic Upgrade Administrator','SUPER_ADMIN');
SQL
count_before="$(psql -d "$source_db" -Atqc \
 'SELECT count(*) FROM "Organization" WHERE id = '\''qa-v5-upgrade-test-org'\''')"
user_before="$(psql -d "$source_db" -Atqc \
 'SELECT count(*) FROM "User" WHERE id = '\''qa-v5-upgrade-test-user'\''')"
[[ "$count_before" == "1" && "$user_before" == "1" ]] || {
 echo "FAIL: synthetic V4 source data not persisted" >&2; exit 1;
}

# Dump and restore V4 FIRST; run every V5 migration on the restored database.
pg_dump -Fc --no-owner --no-acl -f "$base_dir/v4-frozen.dump" "$source_db"
dump_sha_before="$(sha256sum "$base_dir/v4-frozen.dump" | awk '{print $1}')"
pg_restore --exit-on-error --no-owner --no-acl -d "$upgrade_db" "$base_dir/v4-frozen.dump"
SOURCE_DATABASE_MUST_REMAIN_V4=1
DATABASE_URL="$(conn "$upgrade_db")" pnpm --filter @bba/api exec prisma migrate deploy \
 --schema "$root/apps/api/prisma/schema.prisma"
upgraded_migrations="$(psql -d "$upgrade_db" -Atqc \
 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')"
if [[ ! "$upgraded_migrations" =~ ^[0-9]+$ || "$upgraded_migrations" -le "$baseline_migrations" ]]; then
  echo "FAIL: current V5 migrations were not applied to restored frozen V4 database" >&2
  exit 1
fi
if [[ "$(psql -d "$upgrade_db" -Atqc \
 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL')" != "0" ]]; then
  echo "FAIL: partially failed V5 migration found" >&2
  exit 1
fi
for table in SchoolOSUsageBalance SchoolOSUsageReservation SchoolOSVideoUsageReview SchoolOSLiveKitEvent; do
  if [[ "$(psql -d "$upgrade_db" -Atqc \
   "SELECT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.\"$table\"'))")" != "t" ]]; then
    echo "FAIL: expected upgraded V5 table missing: $table" >&2
    exit 1
  fi
done
count_after="$(psql -d "$upgrade_db" -Atqc \
 'SELECT count(*) FROM "Organization" WHERE id = '\''qa-v5-upgrade-test-org'\''')"
user_after="$(psql -d "$upgrade_db" -Atqc \
 'SELECT count(*) FROM "User" WHERE id = '\''qa-v5-upgrade-test-user'\''')"
[[ "$count_after" == "$count_before" && "$user_after" == "$user_before" ]] || {
 echo "FAIL: frozen V4 customer or user data did not survive the upgrade" >&2; exit 1;
}

# A second independent dump/restore validates the complete upgraded state.
pg_dump -Fc --no-owner --no-acl -f "$base_dir/v5-upgraded.dump" "$upgrade_db"
pg_restore --exit-on-error --no-owner --no-acl -d "$restored_db" "$base_dir/v5-upgraded.dump"
restored_migrations="$(psql -d "$restored_db" -Atqc \
 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')"
restored_orgs="$(psql -d "$restored_db" -Atqc \
 'SELECT count(*) FROM "Organization" WHERE id = '\''qa-v5-upgrade-test-org'\''')"
restored_users="$(psql -d "$restored_db" -Atqc \
 'SELECT count(*) FROM "User" WHERE id = '\''qa-v5-upgrade-test-user'\''')"
dump_sha_after="$(sha256sum "$base_dir/v4-frozen.dump" | awk '{print $1}')"
source_still_v4="$(psql -d "$source_db" -Atqc \
 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')"
if [[ "$dump_sha_before" != "$dump_sha_after" ||
      "$source_still_v4" != "$baseline_migrations" ||
      "$restored_migrations" != "$upgraded_migrations" ||
      "$restored_orgs" != "1" || "$restored_users" != "1" ]]; then
 echo "FAIL: V4 source changed or upgraded backup could not be restored losslessly" >&2
 exit 1
fi

# Machine-generated synthetic evidence is not a signed production GO approval.
mkdir -p "$root/artifacts/v5-upgrade-rehearsal"
BASELINE_MIGRATIONS="$baseline_migrations" CURRENT_MIGRATIONS="$upgraded_migrations" \
 V4_DUMP_SHA="$dump_sha_before" node --input-type=module -e '
import fs from "node:fs";
const record = {
 product: "Adhyay SchoolOS", version: "5.0",
 kind: "ISOLATED_SYNTHETIC_V4_TO_V5_UPGRADE_REHEARSAL",
 result: "AUTOMATED_SYNTHETIC_PASS_NOT_STAGING_ACCEPTANCE",
 baselineCommit: process.env.SCHOOLOS_V4_BASE_SHA,
 candidateCommit: process.env.GITHUB_SHA,
 sourceV4MigrationCount: Number(process.env.BASELINE_MIGRATIONS),
 restoredV5MigrationCount: Number(process.env.CURRENT_MIGRATIONS),
 sourceDumpSha256: process.env.V4_DUMP_SHA,
 syntheticOrganizationsPreserved: 1, syntheticUsersPreserved: 1,
 upgradedBackupRestoreVerified: true,
 productionDatabaseTouched: false,
 runId: process.env.GITHUB_RUN_ID ?? null
};
fs.writeFileSync("artifacts/v5-upgrade-rehearsal/result.json",JSON.stringify(record,null,2)+"\n");
'
echo "PASS: V4 ${baseline_migrations} -> V5 ${upgraded_migrations} migrations, tenant data, upgrade backup and restore."
echo "NOTICE: synthetic CI acceptance cannot substitute for staging DR, financial or business-owner signoff."
