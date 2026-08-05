#!/bin/sh
set -eu
backup_dir="${1:?Usage: restore.sh /backups/TIMESTAMP}"
sha256sum -c "$backup_dir/SHA256SUMS"
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" "$backup_dir/database.dump"
mkdir -p /data/storage
tar -xzf "$backup_dir/files.tar.gz" -C /data/storage
echo "Restore completed from $backup_dir"
