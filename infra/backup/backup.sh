#!/bin/sh
set -eu

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="/backups/$stamp"
mkdir -p "$target"

# Prisma accepts ?schema=... in DATABASE_URL, but libpq/pg_dump does not.
pg_dump_url="$(printf '%s\n' "$DATABASE_URL" | sed \
  -e 's/\([?&]\)schema=[^&]*&/\1/' \
  -e 's/[?&]schema=[^&]*$//' \
  -e 's/?&/?/')"

cleanup_incomplete() {
  status=$?
  if [ "$status" -ne 0 ]; then rm -rf "$target"; fi
}
trap cleanup_incomplete EXIT

pg_dump "$pg_dump_url" --format=custom --file="$target/database.dump"
tar -czf "$target/files.tar.gz" -C /data/storage .
sha256sum "$target/database.dump" "$target/files.tar.gz" > "$target/SHA256SUMS"
( cd "$target" && sha256sum -c SHA256SUMS )

cat > "$target/MANIFEST" <<EOF
timestamp_utc=$stamp
local_retention_days=${BACKUP_RETENTION_DAYS:-14}
offsite_bucket=${BACKUP_S3_BUCKET:-}
offsite_prefix=${BACKUP_S3_PREFIX:-backups}
EOF

# Preserve the valid local backup even if the off-site provider is unavailable.
trap - EXIT
find /backups -mindepth 1 -maxdepth 1 -type d -mtime "+${BACKUP_RETENTION_DAYS:-14}" -exec rm -rf -- {} +

aws_s3() {
  if [ -n "${AWS_S3_ENDPOINT:-}" ]; then
    aws --endpoint-url "$AWS_S3_ENDPOINT" s3 "$@"
  else
    aws s3 "$@"
  fi
}

if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  prefix="${BACKUP_S3_PREFIX:-backups}"
  prefix="${prefix#/}"
  prefix="${prefix%/}"
  remote="s3://$BACKUP_S3_BUCKET"
  if [ -n "$prefix" ]; then remote="$remote/$prefix"; fi
  remote="$remote/$stamp/"
  aws_s3 cp "$target" "$remote" --recursive --only-show-errors
  aws_s3 ls "$remote" >/dev/null
  echo "Off-site upload verified: $remote"
fi

echo "Backup completed: $stamp"
