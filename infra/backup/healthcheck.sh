#!/bin/sh
set -eu

now="$(date +%s)"
max_age="${BACKUP_MAX_AGE_SECONDS:-108000}"
success="/backups/.last-success"
failure="/backups/.last-failure"

if [ -f "$failure" ]; then
  echo "Most recent backup attempt failed"
  exit 1
fi

if [ -f "$success" ]; then
  latest_dir="$(cat "$success")"
  if [ ! -d "/backups/$latest_dir" ] || [ ! -f "/backups/$latest_dir/SHA256SUMS" ]; then
    echo "Backup success marker points to an incomplete backup"
    exit 1
  fi
  modified="$(stat -c %Y "$success")"
  age="$((now - modified))"
  if [ "$age" -gt "$max_age" ]; then
    echo "Last successful backup is stale: ${age}s"
    exit 1
  fi
  exit 0
fi

started="$(cat /tmp/backup-container-start 2>/dev/null || echo "$now")"
age="$((now - started))"
if [ "$age" -le "$max_age" ]; then
  echo "No successful backup yet; container remains inside initial grace window"
  exit 0
fi

echo "No successful backup recorded within ${max_age}s"
exit 1
