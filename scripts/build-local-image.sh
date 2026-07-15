#!/usr/bin/env bash

set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

IMAGE_TAG="${1:-$LIBRECHAT_LOCAL_IMAGE}"

if [[ "$IMAGE_TAG" != "$LIBRECHAT_LOCAL_IMAGE" ]]; then
  printf 'Local image tag must match the configured release: %s\n' "$LIBRECHAT_LOCAL_IMAGE" >&2
  exit 1
fi

if docker_cmd image inspect "$IMAGE_TAG" >/dev/null 2>&1; then
  printf 'Local image tag already exists: %s\n' "$IMAGE_TAG" >&2
  printf '%s\n' 'Increment LIBRECHAT_LOCAL_REVISION before building another release.' >&2
  exit 1
fi

docker_cmd build \
  --memory=1g \
  --memory-swap=2g \
  --network=host \
  --build-arg "LIBRECHAT_BASE_IMAGE=$LIBRECHAT_BASE_IMAGE" \
  --build-arg "LIBRECHAT_VERSION=$LIBRECHAT_DISPLAY_VERSION" \
  --file "$ROOT_DIR/Dockerfile.local" \
  --tag "$IMAGE_TAG" \
  "$ROOT_DIR"

printf 'Built local LibreChat image: %s\n' "$IMAGE_TAG"
