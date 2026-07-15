#!/usr/bin/env bash

set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

failures=0

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  failures=1
}

warn() {
  printf 'WARN: %s\n' "$1" >&2
}

ok() {
  printf 'OK: %s\n' "$1"
}

if [[ ! -f "$ENV_FILE" ]]; then
  fail 'Missing .env. Run ./scripts/prepare.sh first.'
fi

if [[ ! -f "$ROOT_DIR/deployment/librechat.yaml" ]]; then
  fail 'Missing librechat.yaml.'
fi

if [[ ! -f "$ROOT_DIR/deployment/admin-panel-server.ts" ]]; then
  fail 'Missing local-only Admin Panel server binding.'
fi

if [[ -f "$ENV_FILE" ]]; then
  env_mode="$(stat -c '%a' "$ENV_FILE")"
  if (( (8#$env_mode & 8#077) != 0 )); then
    fail '.env is readable by group or others; run chmod 600 .env.'
  else
    ok '.env permissions restrict secrets to its owner.'
  fi

  librechat_image="$(awk -F= '$1 == "LIBRECHAT_IMAGE" { print substr($0, index($0, "=") + 1); exit }' "$ENV_FILE")"
  if [[ "$librechat_image" == "$LIBRECHAT_BASE_IMAGE" ]]; then
    ok "LibreChat image is pinned to official v$LIBRECHAT_UPSTREAM_VERSION."
  elif [[ "$librechat_image" == "$LIBRECHAT_LOCAL_IMAGE" ]]; then
    if docker_cmd image inspect "$librechat_image" >/dev/null 2>&1; then
      ok "Local LibreChat $LIBRECHAT_DISPLAY_VERSION derivative image is available."
    else
      fail "Local LibreChat image is missing: $librechat_image. Run ./scripts/build-local-image.sh."
    fi
  else
    fail "LibreChat image must be $LIBRECHAT_BASE_IMAGE or $LIBRECHAT_LOCAL_IMAGE."
  fi

  admin_panel_image="$(awk -F= '$1 == "ADMIN_PANEL_IMAGE" { print substr($0, index($0, "=") + 1); exit }' "$ENV_FILE")"
  if [[ "$admin_panel_image" == 'ghcr.io/clickhouse/librechat-admin-panel@sha256:1d3916ae84439e83da83507afd4aae14a99bd81ff2e1890079f57d8d377eb8e9' ]]; then
    ok 'Admin Panel image is pinned to its verified digest.'
  elif [[ "$admin_panel_image" =~ ^librechat-admin-panel:zh-cn-[A-Za-z0-9._-]+$ ]]; then
    if docker_cmd image inspect "$admin_panel_image" >/dev/null 2>&1; then
      ok 'Local Chinese Admin Panel image is available.'
    else
      fail "Local Admin Panel image is missing: $admin_panel_image."
    fi
  else
    fail 'Admin Panel image must be the verified digest or a local Chinese derivative.'
  fi

  admin_panel_secret="$(awk -F= '$1 == "ADMIN_PANEL_SESSION_SECRET" { print substr($0, index($0, "=") + 1); exit }' "$ENV_FILE")"
  if (( ${#admin_panel_secret} < 32 )); then
    fail 'ADMIN_PANEL_SESSION_SECRET must contain at least 32 characters.'
  else
    ok 'Admin Panel session secret is present.'
  fi
fi

if ! docker_cmd info >/dev/null 2>&1; then
  fail 'Docker daemon is unavailable.'
else
  ok 'Docker daemon is available.'
fi

if ! docker_cmd compose version >/dev/null 2>&1; then
  fail 'Docker Compose v2 is unavailable.'
else
  ok 'Docker Compose v2 is available.'
fi

running_services=''

if [[ -f "$ENV_FILE" ]] && docker_cmd compose version >/dev/null 2>&1; then
  if ! compose config -q; then
    fail 'Compose configuration is invalid.'
  else
    ok 'Compose configuration is valid.'
    running_services="$(compose ps --status running --services 2>/dev/null || true)"
  fi
fi

stack_owns_port() {
  local port="$1"
  local expected_service

  case "$port" in
    3080) expected_service='api' ;;
    27017) expected_service='mongodb' ;;
    3000) expected_service='admin-panel' ;;
    *) return 1 ;;
  esac

  printf '%s\n' "$running_services" | rg -qx "$expected_service"
}

for port in 3080 27017 3000; do
  if ss -ltnH "( sport = :$port )" | rg -q '.'; then
    if stack_owns_port "$port"; then
      ok "Port $port is bound by the running LibreChat stack."
    else
      fail "Port $port is already in use."
    fi
  else
    ok "Port $port is free."
  fi
done

cpu_count="$(nproc)"
memory_mib="$(awk '/MemTotal/ { print int($2 / 1024) }' /proc/meminfo)"
disk_gib="$(df -Pk "$ROOT_DIR" | awk 'NR == 2 { print int($4 / 1024 / 1024) }')"

if (( cpu_count < 2 )); then
  fail "Only $cpu_count CPU core(s) detected; at least 2 are needed."
else
  ok "$cpu_count CPU cores detected."
fi

if (( memory_mib < 4096 )); then
  warn "${memory_mib} MiB RAM detected; 4 GiB is the recommended minimum for a persistent deployment."
else
  ok "${memory_mib} MiB RAM detected."
fi

if (( disk_gib < 15 )); then
  fail "Only ${disk_gib} GiB free disk space; at least 15 GiB is required."
else
  ok "${disk_gib} GiB free disk space detected."
fi

if systemctl is-active --quiet k3s 2>/dev/null; then
  warn 'K3s is active. This stack uses host networking and does not create a Docker bridge.'
fi

if (( failures != 0 )); then
  printf '%s\n' 'Preflight failed. Resolve the FAIL items before deployment.' >&2
  exit 1
fi

printf '%s\n' 'Preflight passed.'
