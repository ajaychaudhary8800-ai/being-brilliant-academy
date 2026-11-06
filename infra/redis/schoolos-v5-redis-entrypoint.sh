#!/bin/sh
# SchoolOS V5: avoid Redis credential plaintext in docker Config.Cmd/ps argv.
# Does NOT remove the runtime REDIS_PASSWORD environment exposure; owner must
# separately protect effective env and rotate compromised historical secrets.
set -eu
umask 077

if [ -z "${REDIS_PASSWORD:-}" ] || [ "${#REDIS_PASSWORD}" -lt 32 ]; then
  echo 'V5_REDIS_RUNTIME_CREDENTIAL=HOLD_INVALID_LENGTH' >&2
  exit 78
fi

# Never echo the password, generated hash, or a command containing the value.
# The ACL file lives only in the container's dedicated 64KiB tmpfs.
acl_dir=/run/schoolos-v5-redis-auth
acl_path="$acl_dir/users.acl"
if [ ! -d "$acl_dir" ] || [ -L "$acl_dir" ] || [ ! -w "$acl_dir" ]; then
  echo 'V5_REDIS_RUNTIME_ACL_TMPFS=HOLD_NOT_MOUNTED' >&2
  exit 78
fi

# The password may contain arbitrary shell punctuation; the hash is always
# valid [a-f0-9]{64}, avoiding password syntax/quoting in redis.conf.
password_sha256="$(printf '%s' "$REDIS_PASSWORD" | sha256sum | cut -d ' ' -f 1)"
case "$password_sha256" in
  *[!a-f0-9]* | '') echo 'V5_REDIS_RUNTIME_ACL_HASH=HOLD' >&2; exit 78 ;;
esac
if [ "${#password_sha256}" -ne 64 ]; then
  echo 'V5_REDIS_RUNTIME_ACL_HASH=HOLD' >&2
  exit 78
fi
# Redis default user starts with nopass: resetpass is MANDATORY before #hash
# or all passwords, including the revoked old one, would remain accepted.
printf 'user default on resetpass #%s ~* &* +@all\\n' "$password_sha256" > "$acl_path"
chmod 0600 "$acl_path"
if [ "$(id -u)" -eq 0 ]; then
  chown redis:redis "$acl_dir" "$acl_path"
fi
unset password_sha256
# Official entrypoint still handles Redis UID drop and persistent /data owner.
# Only a tmpfs ACL path, NEVER the secret, appears in process arguments.
exec /usr/local/bin/docker-entrypoint.sh redis-server \
  --appendonly yes \
  --aclfile "$acl_path" \
  --maxmemory 512mb \
  --maxmemory-policy allkeys-lru
