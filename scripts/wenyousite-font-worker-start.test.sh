#!/usr/bin/env bash
set -euo pipefail

# 正常启动样本不继承门禁进程的迁移凭据；拒绝样本在下方显式注入。
unset DIRECT_DATABASE_URL

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
START_SCRIPT="$SCRIPT_DIR/wenyousite-font-worker-start.sh"
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/wenyousite-font-worker-start-test.XXXXXX")
RELEASE_DIR="$TEST_ROOT/release"
FAKE_NODE="$TEST_ROOT/fake-node"
REVISION_FILE="$RELEASE_DIR/BUILD_SHA"
ENV_FILE="$TEST_ROOT/backend.env"

cleanup() {
  case "$TEST_ROOT" in
    "${TMPDIR:-/tmp}"/wenyousite-font-worker-start-test.*)
      rm -rf --one-file-system -- "$TEST_ROOT"
      ;;
    *)
      echo "拒绝清理非测试目录: $TEST_ROOT" >&2
      ;;
  esac
}
trap cleanup EXIT INT TERM

mkdir -p "$RELEASE_DIR/dist"
printf 'placeholder\n' >"$RELEASE_DIR/dist/font-worker.js"
printf 'placeholder\n' >"$ENV_FILE"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s|%s|%s\n" "${BUILD_SHA:-}" "${NODE_ENV:-}" "${1:-}"' \
  >"$FAKE_NODE"
chmod 0755 "$FAKE_NODE"

valid_sha=0123456789abcdef0123456789abcdef01234567
printf '%s\n' "$valid_sha" >"$REVISION_FILE"
output=$(WENYOU_BACKEND_RELEASE_DIR="$RELEASE_DIR" \
  WENYOU_NODE_BINARY="$FAKE_NODE" \
  WENYOU_BACKEND_REVISION_FILE="$REVISION_FILE" \
  WENYOU_BACKEND_ENV_FILE="$ENV_FILE" \
  bash "$START_SCRIPT")
if [ "$output" != "$valid_sha|production|dist/font-worker" ]; then
  echo "字体 Worker 启动器没有传递精确 revision: $output" >&2
  exit 1
fi
if DIRECT_DATABASE_URL=postgresql://owner:test@example.invalid/wenyousite \
  WENYOU_BACKEND_RELEASE_DIR="$RELEASE_DIR" \
  WENYOU_NODE_BINARY="$FAKE_NODE" \
  WENYOU_BACKEND_REVISION_FILE="$REVISION_FILE" \
  WENYOU_BACKEND_ENV_FILE="$ENV_FILE" \
  bash "$START_SCRIPT" >/dev/null 2>&1; then
  echo "Worker 启动器接受了 owner 直连凭据" >&2
  exit 1
fi

for invalid_root in /tmp/font-work /var/lib/wenyousite/font-work; do
  if TEXT_FONT_STORAGE_ROOT="$invalid_root" \
    WENYOU_BACKEND_RELEASE_DIR="$RELEASE_DIR" \
    WENYOU_NODE_BINARY="$FAKE_NODE" \
    WENYOU_BACKEND_REVISION_FILE="$REVISION_FILE" \
    WENYOU_BACKEND_ENV_FILE="$ENV_FILE" \
    bash "$START_SCRIPT" >/dev/null 2>&1; then
    echo "字体 Worker 接受错误工作目录或缺失 release 工具链" >&2
    exit 1
  fi
done

mkdir -p "$RELEASE_DIR/tools/font-runtime" "$RELEASE_DIR/dist/text-fonts"
printf '{}\n' >"$RELEASE_DIR/tools/font-runtime/wenyou-toolchain.lock.json"
printf 'placeholder\n' >"$RELEASE_DIR/dist/text-fonts/font-sandbox-preflight.js"
cat >"$FAKE_NODE" <<'NODE'
#!/usr/bin/env bash
set -eu
[ "$#" -eq 3 ]
[ "$1" = dist/text-fonts/font-sandbox-preflight.js ]
[ "$2" = /var/lib/wenyousite/font-work ]
[[ "$3" = */release/tools/font-runtime ]]
[ -z "${DATABASE_URL:-}${REDIS_PASSWORD:-}${BUILD_SHA:-}${NODE_ENV:-}" ]
echo 'isolated-preflight'
NODE
output=$(TEXT_FONT_STORAGE_ROOT=/var/lib/wenyousite/font-work \
  DATABASE_URL=synthetic-secret REDIS_PASSWORD=synthetic-secret \
  WENYOU_BACKEND_RELEASE_DIR="$RELEASE_DIR" \
  WENYOU_NODE_BINARY="$FAKE_NODE" \
  WENYOU_BACKEND_REVISION_FILE="$REVISION_FILE" \
  WENYOU_BACKEND_ENV_FILE="$ENV_FILE" \
  bash "$START_SCRIPT" --sandbox-preflight)
[ "$output" = isolated-preflight ] || { echo "预检未隔离环境" >&2; exit 1; }
printf '#!/usr/bin/env bash\nexit 42\n' >"$FAKE_NODE"
if TEXT_FONT_STORAGE_ROOT=/var/lib/wenyousite/font-work \
  WENYOU_BACKEND_RELEASE_DIR="$RELEASE_DIR" \
  WENYOU_NODE_BINARY="$FAKE_NODE" \
  WENYOU_BACKEND_REVISION_FILE="$REVISION_FILE" \
  WENYOU_BACKEND_ENV_FILE="$ENV_FILE" \
  bash "$START_SCRIPT" --sandbox-preflight; then
  echo "启动器吞掉了沙箱预检失败" >&2
  exit 1
else
  [ "$?" -eq 42 ] || { echo "未传播预检退出码" >&2; exit 1; }
fi

printf '#!/usr/bin/env bash\nexit 0\n' >"$FAKE_NODE"
for argument in --sandbox-preflight --unknown; do
  if TEXT_FONT_STORAGE_ROOT= \
    WENYOU_BACKEND_RELEASE_DIR="$RELEASE_DIR" \
    WENYOU_NODE_BINARY="$FAKE_NODE" \
    WENYOU_BACKEND_REVISION_FILE="$REVISION_FILE" \
    WENYOU_BACKEND_ENV_FILE="$ENV_FILE" \
    bash "$START_SCRIPT" "$argument" >/dev/null 2>&1; then
    echo "启动器接受了缺失预检目录或未知参数" >&2
    exit 1
  fi
done

printf 'not-a-sha\n' >"$REVISION_FILE"
if WENYOU_BACKEND_RELEASE_DIR="$RELEASE_DIR" \
  WENYOU_NODE_BINARY="$FAKE_NODE" \
  WENYOU_BACKEND_REVISION_FILE="$REVISION_FILE" \
  WENYOU_BACKEND_ENV_FILE="$ENV_FILE" \
  bash "$START_SCRIPT" >/dev/null 2>&1; then
  echo "字体 Worker 启动器接受了无效 revision" >&2
  exit 1
fi

echo "字体 Worker revision 启动测试通过"
