#!/bin/sh
set -eu
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="/backups/$stamp"
mkdir -p "$target"
pg_dump "$DATABASE_URL" --format=custom --file="$target/database.dump"
tar -czf "$target/files.tar.gz" -C /data/storage .
sha256sum "$target/database.dump" "$target/files.tar.gz" > "$target/SHA256SUMS"
find /backups -mindepth 1 -maxdepth 1 -type d -mtime "+${BACKUP_RETENTION_DAYS:-14}" -exec rm -rf -- {} +
if [ -n "${AWS_S3_BUCKET:-}" ]; then aws s3 cp "$target" "s3://$AWS_S3_BUCKET/$stamp/" --recursive; fi
echo "Backup completed: $stamp"
