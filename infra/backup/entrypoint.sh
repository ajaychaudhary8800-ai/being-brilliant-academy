#!/bin/sh
set -eu
echo "${BACKUP_CRON:-0 2 * * *} /usr/local/bin/backup.sh >> /proc/1/fd/1 2>> /proc/1/fd/2" > /etc/crontabs/root
exec crond -f -l 2
