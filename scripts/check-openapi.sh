#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR/.."
TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/wenyousite-openapi-check.XXXXXX")
cleanup() {
  rm -f -- "$TEMP_DIR/openapi.json"
  rmdir -- "$TEMP_DIR"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
output="$TEMP_DIR/openapi.json"
pnpm openapi:export "$output"
pnpm exec tsx scripts/check-openapi-contract.ts "$output"
pnpm exec tsx scripts/check-contract-artifact.ts "$output"
pnpm exec tsx scripts/check-contract-version.ts
