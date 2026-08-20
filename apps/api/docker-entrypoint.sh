#!/bin/sh
set -eu

if [ "${STORAGE_DRIVER:-local}" = "local" ]; then
  storage_path="${LOCAL_STORAGE_PATH:-/data/storage}"
  case "$storage_path" in
    ""|/|/data|/workspace|/workspace/apps|/workspace/apps/api)
      echo "Refusing unsafe LOCAL_STORAGE_PATH: $storage_path" >&2
      exit 1
      ;;
  esac
  mkdir -p "$storage_path"
  chown app:app "$storage_path"
fi

exec su-exec app "$@"
