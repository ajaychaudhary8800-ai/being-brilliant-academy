#!/bin/sh
set -eu
backup_dir="${1:?Usage: restore.sh /backups/TIMESTAMP}"
sha256sum -c "$backup_dir/SHA256SUMS"
# Match backup.sh: Prisma's ?schema= selector is not accepted by libpq.
# Retain other query parameters; never echo the URL or its credentials.
pg_restore_url="$(printf '%s\n' "$DATABASE_URL" | sed \
  -e 's/\([?&]\)schema=[^&]*&/\1/' \
  -e 's/[?&]schema=[^&]*$//' \
  -e 's/?&/?/')"
pg_restore --clean --if-exists --no-owner --dbname="$pg_restore_url" "$backup_dir/database.dump"
mkdir -p /data/storage
tar -xzf "$backup_dir/files.tar.gz" -C /data/storage
echo "Restore completed from $backup_dir"
