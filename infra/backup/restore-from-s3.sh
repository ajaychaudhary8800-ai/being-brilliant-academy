#!/bin/sh
set -eu

stamp="${1:?Usage: restore-from-s3.sh TIMESTAMP}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"

prefix="${BACKUP_S3_PREFIX:-backups}"
prefix="${prefix#/}"
prefix="${prefix%/}"
remote="s3://$BACKUP_S3_BUCKET"
if [ -n "$prefix" ]; then remote="$remote/$prefix"; fi
remote="$remote/$stamp/"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

aws_s3() {
  if [ -n "${AWS_S3_ENDPOINT:-}" ]; then
    aws --endpoint-url "$AWS_S3_ENDPOINT" s3 "$@"
  else
    aws s3 "$@"
  fi
}

aws_s3 cp "$remote" "$tmp/" --recursive --only-show-errors
/usr/local/bin/restore.sh "$tmp"
