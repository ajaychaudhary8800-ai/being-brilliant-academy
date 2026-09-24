#!/bin/sh
set -eu

: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"
days="${BACKUP_S3_RETENTION_DAYS:-30}"
prefix="${BACKUP_S3_PREFIX:-backups}"
prefix="${prefix#/}"
prefix="${prefix%/}"
if [ -n "$prefix" ]; then prefix="$prefix/"; fi

case "$days" in ''|*[!0-9]*) echo "BACKUP_S3_RETENTION_DAYS must be an integer" >&2; exit 2 ;; esac
[ "$days" -ge 1 ] || { echo "BACKUP_S3_RETENTION_DAYS must be at least 1" >&2; exit 2; }

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
cat > "$tmp" <<EOF
{
  "Rules": [
    {
      "ID": "bba-backup-retention",
      "Status": "Enabled",
      "Filter": { "Prefix": "$prefix" },
      "Expiration": { "Days": $days }
    }
  ]
}
EOF

aws_s3api() {
  if [ -n "${AWS_S3_ENDPOINT:-}" ]; then
    aws --endpoint-url "$AWS_S3_ENDPOINT" s3api "$@"
  else
    aws s3api "$@"
  fi
}

aws_s3api put-bucket-lifecycle-configuration --bucket "$BACKUP_S3_BUCKET" --lifecycle-configuration "file://$tmp"
echo "Configured off-site retention:"
aws_s3api get-bucket-lifecycle-configuration --bucket "$BACKUP_S3_BUCKET"
