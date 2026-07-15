#!/usr/bin/env bash

set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"
require_env_file

read_env_value() {
  awk -F= -v key="$1" '$1 == key { print substr($0, index($0, "=") + 1); exit }' "$ENV_FILE"
}

mongo_user="$(read_env_value MONGO_ROOT_USER)"
mongo_password="$(read_env_value MONGO_ROOT_PASSWORD)"

if [[ -z "$mongo_user" || -z "$mongo_password" ]]; then
  printf '%s\n' 'MongoDB credentials are missing from .env.' >&2
  exit 1
fi

backup_dir="$ROOT_DIR/runtime/backups"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="$backup_dir/LibreChat-$timestamp.archive.gz"

mkdir -p "$backup_dir"
umask 077

compose exec -T mongodb mongodump \
  --host 127.0.0.1 \
  --port 27017 \
  --username "$mongo_user" \
  --password "$mongo_password" \
  --authenticationDatabase admin \
  --db LibreChat \
  --archive \
  --gzip > "$backup_file"

sha256sum "$backup_file" > "$backup_file.sha256"
find "$backup_dir" -maxdepth 1 -type f -name 'LibreChat-*.archive.gz*' -mtime +14 -delete

printf 'Backup created: %s\n' "$backup_file"
