#!/bin/sh
set -eu

backup_dir="${1:?Usage: restore.sh /backups/TIMESTAMP}"
restore_db="${RESTORE_DATABASE_URL:-${DATABASE_URL:-}}"
restore_storage="${RESTORE_STORAGE_PATH:-/data/storage}"

if [ -z "$restore_db" ]; then echo "RESTORE_DATABASE_URL (or DATABASE_URL) is required" >&2; exit 2; fi
if [ -n "${DATABASE_URL:-}" ] && [ "$restore_db" = "$DATABASE_URL" ] && [ "${RESTORE_ALLOW_PRODUCTION:-false}" != "true" ]; then
  echo "Refusing to restore into DATABASE_URL. Set RESTORE_ALLOW_PRODUCTION=true only for intentional production disaster recovery." >&2
  exit 3
fi

for required in database.dump files.tar.gz SHA256SUMS; do
  [ -f "$backup_dir/$required" ] || { echo "Backup directory is incomplete: missing $required" >&2; exit 4; }
done
( cd "$backup_dir" && sha256sum -c SHA256SUMS )
tar -tzf "$backup_dir/files.tar.gz" >/dev/null
pg_restore --list "$backup_dir/database.dump" >/dev/null

restore_pg_url="$(printf '%s\n' "$restore_db" | sed \
  -e 's/\([?&]\)schema=[^&]*&/\1/' \
  -e 's/[?&]schema=[^&]*$//' \
  -e 's/?&/?/')"

started="$(date +%s)"
pg_restore --clean --if-exists --no-owner --dbname="$restore_pg_url" "$backup_dir/database.dump"
mkdir -p "$restore_storage"
rm -rf "$restore_storage"/*
tar -xzf "$backup_dir/files.tar.gz" -C "$restore_storage"
table_count="$(psql "$restore_pg_url" -Atc "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='public';")"
file_count="$(find "$restore_storage" -type f | wc -l | tr -d ' ')"
elapsed="$(( $(date +%s) - started ))"
[ "${table_count:-0}" -gt 0 ] || { echo "Restore verification failed: no public tables found" >&2; exit 5; }

echo "Restore completed from $backup_dir"
echo "restore_elapsed_seconds=$elapsed"
echo "restored_public_tables=$table_count"
echo "restored_files=$file_count"
