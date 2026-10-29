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


# The V5-only API receives private classroom and recording provider settings
# from a dedicated bind mount. Never source/eval the file: allowlist literals.
if [ "${SCHOOLOS_V5_LIVEKIT_ENV_FILE:-}" = "/run/secrets/schoolos-v5-livekit-api.env" ]; then
  media_file="$SCHOOLOS_V5_LIVEKIT_ENV_FILE"
  if [ ! -f "$media_file" ] || [ ! -r "$media_file" ]; then
    echo "V5 API media credential file missing/unreadable" >&2
    exit 1
  fi
  seen_media=" "
  while IFS= read -r entry || [ -n "$entry" ]; do
    case "$entry" in
      ""|\#*) continue ;;
      LIVEKIT_URL=*|LIVEKIT_API_KEY=*|LIVEKIT_API_SECRET=*|\
      LIVEKIT_RECORDING_PREFIX=*|LIVEKIT_RECORDING_S3_REGION=*|\
      LIVEKIT_RECORDING_S3_BUCKET=*|LIVEKIT_RECORDING_S3_ENDPOINT=*|\
      LIVEKIT_RECORDING_S3_ACCESS_KEY_ID=*|LIVEKIT_RECORDING_S3_SECRET_ACCESS_KEY=*)
        key=${entry%%=*}
        value=${entry#*=}
        case " $seen_media " in
          *" $key "*) echo "Duplicate V5 media setting" >&2; exit 1 ;;
        esac
        case "$value" in
          \"*\") value=${value#\"}; value=${value%\"} ;;
          \'*\') value=${value#\'}; value=${value%\'} ;;
        esac
        if [ -z "$value" ]; then
          echo "Empty V5 media setting" >&2
          exit 1
        fi
        seen_media="$seen_media$key "
        export "$key=$value"
        ;;
      *) echo "Invalid V5 media credential file entry" >&2; exit 1 ;;
    esac
  done < "$media_file"
  for required in LIVEKIT_URL LIVEKIT_API_KEY LIVEKIT_API_SECRET \
    LIVEKIT_RECORDING_S3_BUCKET LIVEKIT_RECORDING_S3_ENDPOINT \
    LIVEKIT_RECORDING_S3_ACCESS_KEY_ID LIVEKIT_RECORDING_S3_SECRET_ACCESS_KEY; do
    case " $seen_media " in
      *" $required "*) ;;
      *) echo "V5 media credential file incomplete" >&2; exit 1 ;;
    esac
  done
  unset media_file seen_media entry key value required
fi


# Isolated SchoolOS V5 staging-only: preserve the exact four existing API
# authentication/mail/Vault values without injecting them into other services.
# Do not source/eval; treat the root-owned read-only file as literal data.
# The setting is absent on frozen V4, which retains its existing startup path.
if [ -n "${SCHOOLOS_V5_APP_ENV_FILE:-}" ]; then
  if [ "$SCHOOLOS_V5_APP_ENV_FILE" != "/run/secrets/schoolos-v5-app-api.env" ]; then
    echo "Invalid V5 app credential file path" >&2
    exit 1
  fi
  app_file="$SCHOOLOS_V5_APP_ENV_FILE"
  if [ ! -f "$app_file" ] || [ ! -r "$app_file" ]; then
    echo "V5 API app credential file missing/unreadable" >&2
    exit 1
  fi
  seen_app=" "
  while IFS= read -r entry || [ -n "$entry" ]; do
    case "$entry" in
      ""|\#*) continue ;;
      JWT_ACCESS_SECRET=*|JWT_REFRESH_SECRET=*|SMTP_PASSWORD=*|COMMERCIAL_DOCUMENT_ENCRYPTION_KEY=*)
        key=${entry%%=*}
        value=${entry#*=}
        case " $seen_app " in
          *" $key "*) echo "Duplicate V5 app credential entry" >&2; exit 1 ;;
        esac
        case "$value" in
          \"*\") value=${value#\"}; value=${value%\"} ;;
          \'*\') value=${value#\'}; value=${value%\'} ;;
        esac
        if [ -z "$value" ]; then
          echo "Empty V5 app credential entry" >&2
          exit 1
        fi
        seen_app="$seen_app$key "
        export "$key=$value"
        ;;
      *) echo "Invalid V5 app credential entry" >&2; exit 1 ;;
    esac
  done < "$app_file"
  for required in JWT_ACCESS_SECRET JWT_REFRESH_SECRET SMTP_PASSWORD COMMERCIAL_DOCUMENT_ENCRYPTION_KEY; do
    case " $seen_app " in
      *" $required "*) ;;
      *) echo "V5 app credential file incomplete" >&2; exit 1 ;;
    esac
  done
  unset app_file seen_app entry key value required
fi

exec su-exec app "$@"
