#!/usr/bin/env bash

set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

timeout_seconds="${1:-120}"
deadline=$((SECONDS + timeout_seconds))

while (( SECONDS < deadline )); do
  if curl --fail --silent --connect-timeout 2 --max-time 5 http://127.0.0.1:3080/readyz | rg -qx 'OK' && \
    curl --fail --silent --connect-timeout 2 --max-time 5 http://127.0.0.1:3000/health | rg -qx 'ok'; then
    printf '%s\n' 'LibreChat is ready at http://127.0.0.1:3080 and Admin Panel is ready at http://127.0.0.1:3000.'
    compose ps
    exit 0
  fi
  sleep 3
done

printf 'LibreChat or Admin Panel did not become ready within %s seconds.\n' "$timeout_seconds" >&2
compose ps >&2 || true
compose logs --tail=100 api mongodb admin-panel >&2 || true
exit 1
