#!/usr/bin/env bash

set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

TEMPLATE_FILE="$ROOT_DIR/deployment/env.template"
EXPECTED_IMAGE="$LIBRECHAT_BASE_IMAGE"
LEGACY_IMAGE="ghcr.io/danny-avila/librechat:v${LIBRECHAT_UPSTREAM_VERSION}@${LIBRECHAT_BASE_DIGEST}"
ADMIN_PANEL_IMAGE='ghcr.io/clickhouse/librechat-admin-panel@sha256:1d3916ae84439e83da83507afd4aae14a99bd81ff2e1890079f57d8d377eb8e9'

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

require_command openssl

ensure_env_value() {
  local key="$1"
  local value="$2"

  if rg -q "^${key}=" "$ENV_FILE"; then
    return
  fi

  printf '\n%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  printf 'Added %s to .env.\n' "$key"
}

mkdir -p "$ROOT_DIR/runtime/mongo" "$ROOT_DIR/runtime/uploads" "$ROOT_DIR/runtime/logs" "$ROOT_DIR/runtime/backups"
chmod 700 "$ROOT_DIR/runtime" "$ROOT_DIR/runtime/backups"
chmod 750 "$ROOT_DIR/runtime/uploads" "$ROOT_DIR/runtime/logs"

if [[ ! -f "$ENV_FILE" ]]; then
  umask 077
  jwt_secret="$(openssl rand -hex 32)"
  jwt_refresh_secret="$(openssl rand -hex 32)"
  creds_key="$(openssl rand -hex 32)"
  creds_iv="$(openssl rand -hex 16)"
  mongo_password="$(openssl rand -hex 24)"
  admin_panel_session_secret="$(openssl rand -hex 32)"
  openid_session_secret="$(openssl rand -hex 32)"

  sed \
    -e "s|__LIBRECHAT_BASE_IMAGE__|$LIBRECHAT_BASE_IMAGE|" \
    -e "s|__LIBRECHAT_DISPLAY_VERSION__|$LIBRECHAT_DISPLAY_VERSION|" \
    -e "s/__JWT_SECRET__/$jwt_secret/" \
    -e "s/__JWT_REFRESH_SECRET__/$jwt_refresh_secret/" \
    -e "s/__CREDS_KEY__/$creds_key/" \
    -e "s/__CREDS_IV__/$creds_iv/" \
    -e "s/__MONGO_ROOT_PASSWORD__/$mongo_password/" \
    -e "s/__ADMIN_PANEL_SESSION_SECRET__/$admin_panel_session_secret/" \
    -e "s/__OPENID_SESSION_SECRET__/$openid_session_secret/" \
    "$TEMPLATE_FILE" > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  printf '%s\n' 'Created .env with fresh local secrets.'
else
  chmod 600 "$ENV_FILE"
  if rg -Fqx "LIBRECHAT_IMAGE=$LEGACY_IMAGE" "$ENV_FILE"; then
    temporary_env="$(mktemp "$ROOT_DIR/.env.XXXXXX")"
    sed "s|^LIBRECHAT_IMAGE=$LEGACY_IMAGE$|LIBRECHAT_IMAGE=$EXPECTED_IMAGE|" "$ENV_FILE" > "$temporary_env"
    chmod 600 "$temporary_env"
    mv "$temporary_env" "$ENV_FILE"
    printf '%s\n' 'Switched the pinned image source to the matching Docker Hub manifest.'
  fi
  ensure_env_value ADMIN_PANEL_IMAGE "$ADMIN_PANEL_IMAGE"
  ensure_env_value ADMIN_PANEL_URL http://localhost:3000
  if ! rg -q '^ADMIN_PANEL_SESSION_SECRET=.' "$ENV_FILE"; then
    ensure_env_value ADMIN_PANEL_SESSION_SECRET "$(openssl rand -hex 32)"
  fi
  if ! rg -q '^OPENID_SESSION_SECRET=.' "$ENV_FILE"; then
    ensure_env_value OPENID_SESSION_SECRET "$(openssl rand -hex 32)"
  fi
  printf '%s\n' 'Keeping the existing .env and its secrets.'
fi

current_uid="$(id -u)"
current_gid="$(id -g)"
chown "$current_uid:$current_gid" "$ROOT_DIR/runtime/uploads" "$ROOT_DIR/runtime/logs"

if [[ "$(id -u)" -eq 0 ]]; then
  chown -R 999:999 "$ROOT_DIR/runtime/mongo"
  chmod 700 "$ROOT_DIR/runtime/mongo"
elif command -v sudo >/dev/null 2>&1; then
  sudo chown -R 999:999 "$ROOT_DIR/runtime/mongo"
  sudo chmod 700 "$ROOT_DIR/runtime/mongo"
else
  printf '%s\n' 'Warning: MongoDB data directory was not chowned to uid 999.' >&2
fi

printf '%s\n' 'Preparation complete. Run ./scripts/preflight.sh next.'
