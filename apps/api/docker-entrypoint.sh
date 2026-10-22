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


# V5-specific protected Razorpay credentials, mounted only in the API service.
if [ "${SCHOOLOS_V5_RAZORPAY_ENV_FILE:-}" = "/run/secrets/schoolos-v5-razorpay-api.env" ]; then
  secrets_file="$SCHOOLOS_V5_RAZORPAY_ENV_FILE"
  if [ ! -f "$secrets_file" ] || [ ! -r "$secrets_file" ]; then
    echo "V5 API Razorpay credential file missing/unreadable" >&2
    exit 1
  fi
  found_key=false
  found_webhook=false
  while IFS= read -r entry || [ -n "$entry" ]; do
    case "$entry" in
      RAZORPAY_KEY_SECRET=*|RAZORPAY_WEBHOOK_SECRET=*)
        key=${entry%%=*}
        value=${entry#*=}
        case "$value" in
          \"*\") value=${value#\"}; value=${value%\"} ;;
          \'*\') value=${value#\'}; value=${value%\'} ;;
        esac
        if [ -z "$value" ]; then
          echo "V5 API Razorpay credential value empty: $key" >&2
          exit 1
        fi
        export "$key=$value"
        case "$key" in
          RAZORPAY_KEY_SECRET) found_key=true ;;
          RAZORPAY_WEBHOOK_SECRET) found_webhook=true ;;
        esac
        ;;
    esac
  done < "$secrets_file"
  if [ "$found_key" != true ] || [ "$found_webhook" != true ]; then
    echo "V5 API Razorpay credential file is incomplete" >&2
    exit 1
  fi
  unset secrets_file found_key found_webhook entry key value
fi

exec su-exec app "$@"
