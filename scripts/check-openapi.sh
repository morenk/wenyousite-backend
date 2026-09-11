#!/usr/bin/env bash
set -euo pipefail

# 每次检查独占临时目录，避免并发 Worktree 或不同用户覆盖同一个产物。
openapi_check_dir="$(mktemp -d "${TMPDIR:-/tmp}/wenyousite-openapi-check.XXXXXX")"
trap 'rm -rf -- "$openapi_check_dir"' EXIT
openapi_check_file="$openapi_check_dir/openapi.json"
pnpm openapi:export "$openapi_check_file"
pnpm exec tsx scripts/check-openapi-contract.ts "$openapi_check_file"
pnpm exec tsx scripts/check-contract-artifact.ts "$openapi_check_file"
pnpm exec tsx scripts/check-contract-version.ts
