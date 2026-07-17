#!/usr/bin/env bash

set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_env_file

configured_domain="$(awk -F= '$1 == "PUBLIC_DOMAIN" { print substr($0, index($0, "=") + 1); exit }' "$ENV_FILE")"
domain="${1:-$configured_domain}"

if [[ ! "$domain" =~ ^[A-Za-z0-9.-]+$ ]]; then
  printf 'Invalid domain: %s\n' "$domain" >&2
  exit 1
fi

replace_env_value() {
  local key="$1"
  local value="$2"
  local temporary
  temporary="$(mktemp "$ROOT_DIR/.env.XXXXXX")"
  awk -F= -v key="$key" -v value="$value" '
    $1 == key { print key "=" value; found = 1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$ENV_FILE" > "$temporary"
  chmod 600 "$temporary"
  mv "$temporary" "$ENV_FILE"
}

replace_env_value PUBLIC_DOMAIN "$domain"
replace_env_value DOMAIN_CLIENT "https://$domain"
replace_env_value DOMAIN_SERVER "https://$domain"
replace_env_value SESSION_COOKIE_SECURE true
replace_env_value TRUST_PROXY 1

printf 'Configured LibreChat for https://%s. Restarting the API container...\n' "$domain"
compose up -d --no-deps --force-recreate api
"$ROOT_DIR/scripts/healthcheck.sh"
