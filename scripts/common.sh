#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.local.yml"
ENV_FILE="$ROOT_DIR/.env"
VERSION_FILE="$ROOT_DIR/deployment/version.env"
PROJECT_NAME="librechat-local"

if [[ ! -f "$VERSION_FILE" ]]; then
  printf 'Missing version configuration: %s\n' "$VERSION_FILE" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$VERSION_FILE"

if [[ ! "$LIBRECHAT_UPSTREAM_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  printf '%s\n' 'LIBRECHAT_UPSTREAM_VERSION must use X.Y.Z.' >&2
  exit 1
fi
if [[ ! "$LIBRECHAT_LOCAL_REVISION" =~ ^[1-9][0-9]*$ ]]; then
  printf '%s\n' 'LIBRECHAT_LOCAL_REVISION must be a positive integer.' >&2
  exit 1
fi
if [[ ! "$LIBRECHAT_BASE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  printf '%s\n' 'LIBRECHAT_BASE_DIGEST must be a sha256 image digest.' >&2
  exit 1
fi

LIBRECHAT_DISPLAY_VERSION="v${LIBRECHAT_UPSTREAM_VERSION}.${LIBRECHAT_LOCAL_REVISION}"
LIBRECHAT_BASE_IMAGE="librechat/librechat:v${LIBRECHAT_UPSTREAM_VERSION}@${LIBRECHAT_BASE_DIGEST}"
LIBRECHAT_LOCAL_IMAGE="librechat-local:${LIBRECHAT_DISPLAY_VERSION}"

docker_cmd() {
  if docker info >/dev/null 2>&1; then
    docker "$@"
    return
  fi

  if command -v sudo >/dev/null 2>&1; then
    sudo docker "$@"
    return
  fi

  printf '%s\n' 'Docker is unavailable. Install and start Docker first.' >&2
  return 1
}

compose() {
  docker_cmd compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

require_env_file() {
  if [[ ! -f "$ENV_FILE" ]]; then
    printf '%s\n' "Missing $ENV_FILE. Run ./scripts/prepare.sh first." >&2
    return 1
  fi
}
