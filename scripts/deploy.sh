#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

"$ROOT_DIR/scripts/prepare.sh"
"$ROOT_DIR/scripts/preflight.sh"

source "$ROOT_DIR/scripts/common.sh"

librechat_image="$(awk -F= '$1 == "LIBRECHAT_IMAGE" { print substr($0, index($0, "=") + 1); exit }' "$ENV_FILE")"
admin_panel_image="$(awk -F= '$1 == "ADMIN_PANEL_IMAGE" { print substr($0, index($0, "=") + 1); exit }' "$ENV_FILE")"
pull_services=(mongodb)

if [[ "$librechat_image" == "$LIBRECHAT_LOCAL_IMAGE" ]]; then
  if ! docker_cmd image inspect "$librechat_image" >/dev/null 2>&1; then
    printf 'Missing local LibreChat image: %s\n' "$librechat_image" >&2
    printf '%s\n' 'Run ./scripts/build-local-image.sh before deploying.' >&2
    exit 1
  fi
  printf 'Using the locally built LibreChat %s derivative image.\n' "$LIBRECHAT_DISPLAY_VERSION"
else
  pull_services+=(api)
fi

if [[ "$admin_panel_image" =~ ^librechat-admin-panel:zh-cn-[A-Za-z0-9._-]+$ ]]; then
  if ! docker_cmd image inspect "$admin_panel_image" >/dev/null 2>&1; then
    printf 'Missing local Admin Panel image: %s\n' "$admin_panel_image" >&2
    exit 1
  fi
  printf '%s\n' 'Using the locally built Chinese Admin Panel image.'
else
  pull_services+=(admin-panel)
fi

printf '%s\n' 'Pulling required remote images...'
compose pull "${pull_services[@]}"

printf '%s\n' 'Starting LibreChat and MongoDB...'
compose up -d --remove-orphans

"$ROOT_DIR/scripts/healthcheck.sh"
