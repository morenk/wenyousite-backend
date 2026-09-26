#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
grep -Fq 'ENV_FILE=${BACKEND_ENV_FILE:-/etc/wenyousite/backend.env}' "$SCRIPT_DIR/promote-android-release.sh"
grep -Fq 'install -m 0755 "$SCRIPT_DIR/promote-android-release.sh" /usr/local/sbin/wenyousite-promote-android' "$SCRIPT_DIR/deploy.sh"
node --test "$SCRIPT_DIR/mobile-release.test.cjs"
