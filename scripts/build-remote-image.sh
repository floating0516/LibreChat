#!/usr/bin/env bash

set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

WORKFLOW_FILE='librechat-local-image.yml'
ARTIFACT_NAME='librechat-local-image-metadata'
dry_run=false

usage() {
  cat <<'EOF'
Usage: ./scripts/build-remote-image.sh [--dry-run]

Dispatch the GitHub Actions LibreChat image build for the current pushed commit,
wait for verification, pull the immutable GHCR digest, and apply the configured
local image tag. This command does not deploy or change .env.
EOF
}

case "${1:-}" in
  '') ;;
  --dry-run) dry_run=true ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

for command in git gh jq; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$command" >&2
    exit 1
  fi
done

if ! git diff --quiet || ! git diff --cached --quiet; then
  printf '%s\n' 'Tracked changes must be committed before a remote build.' >&2
  exit 1
fi

origin_url="$(git remote get-url origin)"
repo="$(gh repo view "$origin_url" --json nameWithOwner --jq .nameWithOwner)"
if [[ "$repo" == 'danny-avila/LibreChat' ]]; then
  printf '%s\n' 'Refusing to dispatch a build in the upstream repository.' >&2
  exit 1
fi

branch="$(git branch --show-current)"
commit="$(git rev-parse HEAD)"
if [[ -z "$branch" || ! "$commit" =~ ^[0-9a-f]{40}$ ]]; then
  printf '%s\n' 'A named branch and full commit SHA are required.' >&2
  exit 1
fi

remote_commit="$(git ls-remote origin "refs/heads/$branch" | awk 'NR == 1 { print $1 }')"
if [[ "$remote_commit" != "$commit" ]]; then
  printf 'Push %s to origin/%s before the remote build.\n' "$commit" "$branch" >&2
  exit 1
fi

gh workflow view "$WORKFLOW_FILE" --repo "$repo" >/dev/null

owner="${repo%%/*}"
owner="$(printf '%s' "$owner" | tr '[:upper:]' '[:lower:]')"
expected_image="ghcr.io/${owner}/librechat-local:${LIBRECHAT_DISPLAY_VERSION}"

if [[ "$dry_run" == true ]]; then
  printf 'Repository: %s\n' "$repo"
  printf 'Branch: %s\n' "$branch"
  printf 'Commit: %s\n' "$commit"
  printf 'Version: %s\n' "$LIBRECHAT_DISPLAY_VERSION"
  printf 'Remote image: %s\n' "$expected_image"
  printf '%s\n' 'Dry run complete; no workflow was dispatched.'
  exit 0
fi

if docker_cmd image inspect "$LIBRECHAT_LOCAL_IMAGE" >/dev/null 2>&1; then
  printf 'Local immutable image tag already exists: %s\n' "$LIBRECHAT_LOCAL_IMAGE" >&2
  exit 1
fi

dispatched_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
gh workflow run "$WORKFLOW_FILE" \
  --repo "$repo" \
  --ref "$branch" \
  --field "commit_sha=$commit"

run_json=''
for _ in $(seq 1 30); do
  runs="$(gh run list \
    --repo "$repo" \
    --workflow "$WORKFLOW_FILE" \
    --event workflow_dispatch \
    --limit 20 \
    --json databaseId,headSha,createdAt,status,url)"
  run_json="$(jq -c \
    --arg commit "$commit" \
    --arg dispatched_at "$dispatched_at" \
    '[.[] | select(.headSha == $commit and .createdAt >= $dispatched_at)]
     | sort_by(.createdAt) | last // empty' <<< "$runs")"
  if [[ -n "$run_json" ]]; then
    break
  fi
  sleep 2
done

if [[ -z "$run_json" ]]; then
  printf '%s\n' 'Unable to locate the dispatched workflow run.' >&2
  exit 1
fi

run_id="$(jq -r .databaseId <<< "$run_json")"
run_url="$(jq -r .url <<< "$run_json")"
printf 'Watching GitHub Actions run: %s\n' "$run_url"
gh run watch "$run_id" --repo "$repo" --exit-status

metadata_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$metadata_dir"
}
trap cleanup EXIT

gh run download "$run_id" \
  --repo "$repo" \
  --name "$ARTIFACT_NAME" \
  --dir "$metadata_dir"

(cd "$metadata_dir" && sha256sum -c image.json.sha256)
metadata_file="$metadata_dir/image.json"
if ! jq -e \
  --arg commit "$commit" \
  --arg version "$LIBRECHAT_DISPLAY_VERSION" \
  --arg image "$expected_image" \
  '.commit == $commit
   and .version == $version
   and .image == $image
   and (.digest | test("^sha256:[0-9a-f]{64}$"))' \
  "$metadata_file" >/dev/null; then
  printf '%s\n' 'Remote image metadata does not match the requested release.' >&2
  exit 1
fi

image="$(jq -r .image "$metadata_file")"
digest="$(jq -r .digest "$metadata_file")"
image_ref="${image}@${digest}"

if ! docker_cmd pull "$image_ref"; then
  token="$(gh auth token)"
  printf '%s' "$token" | docker_cmd login ghcr.io --username "$owner" --password-stdin >/dev/null
  unset token
  docker_cmd pull "$image_ref"
fi

repo_digests="$(docker_cmd image inspect "$image_ref" --format '{{ json .RepoDigests }}')"
if ! jq -e --arg digest "$digest" 'any(.[]; endswith("@" + $digest))' \
  <<< "$repo_digests" >/dev/null; then
  printf 'Pulled image does not expose the expected digest: %s\n' "$digest" >&2
  exit 1
fi

docker_cmd tag "$image_ref" "$LIBRECHAT_LOCAL_IMAGE"
printf 'Remote build verified: %s\n' "$run_url"
printf 'Pulled immutable image: %s\n' "$image_ref"
printf 'Applied local tag: %s\n' "$LIBRECHAT_LOCAL_IMAGE"
