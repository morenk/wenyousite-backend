#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
START_SCRIPT="$SCRIPT_DIR/wenyousite-backend-start.sh"
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/wenyousite-backend-start-test.XXXXXX")
BACKEND_DIR="$TEST_ROOT/backend"
FAKE_NODE="$TEST_ROOT/fake-node"
REVISION_FILE="$TEST_ROOT/current-revision"

cleanup() {
  case "$TEST_ROOT" in
    "${TMPDIR:-/tmp}"/wenyousite-backend-start-test.*)
      rm -rf --one-file-system -- "$TEST_ROOT"
      ;;
    *)
      echo "拒绝清理非测试目录: $TEST_ROOT" >&2
      ;;
  esac
}
trap cleanup EXIT INT TERM

mkdir -p "$BACKEND_DIR/dist"
printf 'placeholder\n' >"$BACKEND_DIR/dist/main.js"
printf 'placeholder\n' >"$BACKEND_DIR/.env"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s|%s|%s\n" "${BUILD_SHA:-}" "${NODE_ENV:-}" "${1:-}"' \
  >"$FAKE_NODE"
chmod 0755 "$FAKE_NODE"

valid_sha=0123456789abcdef0123456789abcdef01234567
printf '%s\n' "$valid_sha" >"$REVISION_FILE"
output=$(WENYOU_BACKEND_DIR="$BACKEND_DIR" \
  WENYOU_NODE_BINARY="$FAKE_NODE" \
  WENYOU_BACKEND_REVISION_FILE="$REVISION_FILE" \
  bash "$START_SCRIPT")
if [ "$output" != "$valid_sha|production|dist/main" ]; then
  echo "后端启动器没有传递精确 revision: $output" >&2
  exit 1
fi

printf 'not-a-sha\n' >"$REVISION_FILE"
if WENYOU_BACKEND_DIR="$BACKEND_DIR" \
  WENYOU_NODE_BINARY="$FAKE_NODE" \
  WENYOU_BACKEND_REVISION_FILE="$REVISION_FILE" \
  bash "$START_SCRIPT" >/dev/null 2>&1; then
  echo "后端启动器接受了无效 revision" >&2
  exit 1
fi

rm -f -- "$REVISION_FILE"
if WENYOU_BACKEND_DIR="$BACKEND_DIR" \
  WENYOU_NODE_BINARY="$FAKE_NODE" \
  WENYOU_BACKEND_REVISION_FILE="$REVISION_FILE" \
  bash "$START_SCRIPT" >/dev/null 2>&1; then
  echo "后端启动器接受了缺失 revision" >&2
  exit 1
fi

echo "后端 revision 启动测试通过"
