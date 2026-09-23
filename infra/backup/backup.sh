#!/bin/sh
set -eu

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="/backups/$stamp"
mkdir -p "$target"

# Prisma accepts ?schema=... in DATABASE_URL, but libpq/pg_dump does not.
# Remove only the Prisma-specific schema query parameter while preserving
# any other libpq-compatible query parameters.
pg_dump_url="$(printf '%s\n' "$DATABASE_URL" | sed \
  -e 's/\([?&]\)schema=[^&]*&/\1/' \
  -e 's/[?&]schema=[^&]*$//' \
  -e 's/?&/?/')"

# Do not leave an apparently valid timestamped backup directory behind
# when any backup step fails.
trap 'status=$?; if [ "$status" -ne 0 ]; then rm -rf "$target"; fi' EXIT

pg_dump "$pg_dump_url" --format=custom --file="$target/database.dump"
tar -czf "$target/files.tar.gz" -C /data/storage .
sha256sum "$target/database.dump" "$target/files.tar.gz" > "$target/SHA256SUMS"
find /backups -mindepth 1 -maxdepth 1 -type d -mtime "+${BACKUP_RETENTION_DAYS:-14}" -exec rm -rf -- {} +
if [ -n "${AWS_S3_BUCKET:-}" ]; then aws s3 cp "$target" "s3://$AWS_S3_BUCKET/$stamp/" --recursive; fi

trap - EXIT
echo "Backup completed: $stamp"
