#!/usr/bin/env bash
set -euo pipefail

# Requires root only to exercise real ownership and runuser. All writes stay in
# one temporary fixture; no systemd, Docker, credentials or live release access.
[ "$(id -u)" -eq 0 ] || { echo "此隔离权限集成测试需要 root" >&2; exit 1; }
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
APP_USER=wenyousite-backend
RUNTIME_GROUP=wenyousite-runtime
NODE_SOURCE=$(command -v node)
TEST_ROOT=$(mktemp -d /tmp/wenyousite-release-permissions.XXXXXX)
cleanup() {
  case "$TEST_ROOT" in
    /tmp/wenyousite-release-permissions.*) rm -rf --one-file-system -- "$TEST_ROOT" ;;
    *) echo "拒绝清理非测试目录" >&2; return 1 ;;
  esac
}
trap cleanup EXIT
chmod 0755 "$TEST_ROOT"
repo="$TEST_ROOT/repo"
runtime="$TEST_ROOT/runtime"
mkdir -p "$repo/scripts" "$TEST_ROOT/bin"
cp "$SCRIPT_DIR/assemble-backend-release.sh" "$repo/scripts/"
# Optional old script proves the incident against the same fixture.
if [ "${1:-}" = --baseline ]; then
  [ "$#" -eq 2 ] || exit 2
  cp "$2" "$repo/scripts/assemble-backend-release.sh"
elif [ "$#" -ne 0 ]; then
  exit 2
fi

# Run the deploy initialization itself, stopping before any deployment action.
(
  umask 077
  source <(sed '/^SCRIPT_DIR=/,$d' "$SCRIPT_DIR/deploy.sh")
  mkdir "$TEST_ROOT/build-mask"
  : > "$TEST_ROOT/build-mask/output.js"
)
[ "$(stat -c %a "$TEST_ROOT/build-mask")" = 755 ]
[ "$(stat -c %a "$TEST_ROOT/build-mask/output.js")" = 644 ]

(
  umask 077
  mkdir -p "$repo/dist/media" "$repo/docker" "$repo/prisma" "$repo/node_modules"
  printf 'module.exports = {};\n' > "$repo/dist/main.js"
  cp "$repo/dist/main.js" "$repo/dist/image-worker.js"
  printf "module.exports = require('pino-pretty');\n" > "$repo/dist/app.module.js"
  cp "$repo/dist/app.module.js" "$repo/dist/media/image-worker.module.js"
  printf '{}\n' > "$repo/package.json"
  touch "$repo/docker-compose.yml" "$repo/pnpm-lock.yaml" "$repo/pnpm-workspace.yaml"
  printf 'test secret, outside release\n' > "$TEST_ROOT/private.env"
)
[ "$(stat -c %a "$repo/dist")" = 700 ]
[ "$(stat -c %a "$repo/dist/main.js")" = 600 ]
# Avoid dependency downloads; exercise the real assembler, Node and service UID.
cat > "$TEST_ROOT/bin/pnpm" <<'PNPM'
#!/usr/bin/env bash
set -euo pipefail
[ "$1" = --dir ]
for module in prisma pino-pretty pino-roll; do
  mkdir -p "$2/node_modules/$module"
  printf 'module.exports = {};\n' > "$2/node_modules/$module/index.js"
done
PNPM
chmod 0755 "$TEST_ROOT/bin/pnpm"
sha=1111111111111111111111111111111111111111
assemble() {
  (
    umask 077
    PATH="$TEST_ROOT/bin:$PATH" WENYOUSITE_RUNTIME_ROOT="$runtime" \
      WENYOUSITE_APP_USER="$APP_USER" WENYOUSITE_RUNTIME_GROUP="$RUNTIME_GROUP" \
      WENYOUSITE_NODE_SOURCE="$NODE_SOURCE" bash "$repo/scripts/assemble-backend-release.sh" --sha "$sha"
  )
}
assemble > "$TEST_ROOT/assembly.log" 2>&1 || { cat "$TEST_ROOT/assembly.log"; exit 1; }
release="$runtime/releases/$sha"
if [ "${1:-}" = --baseline ]; then
  [ "$(readlink "$runtime/current")" = "releases/$sha" ]
  if runuser -u "$APP_USER" -- test -r "$release/dist/main.js"; then
    echo "旧脚本未复现权限故障" >&2; exit 1
  fi
  echo "旧脚本复现：切换成功但服务身份无法读取 dist/main.js"
  exit 0
fi
[ "$(readlink "$runtime/current")" = "releases/$sha" ]
[ "$(cat "$runtime/current-revision")" = "$sha" ]
for entry in main.js image-worker.js; do
  runuser -u "$APP_USER" -- test -r "$release/dist/$entry"
  [ "$(stat -c %a "$release/dist/$entry")" = 640 ]
done
[ "$(stat -c %a "$release/dist")" = 750 ]
[ "$(stat -c %a "$release/package.json")" = 640 ]
[ "$(stat -c %a "$repo/dist")" = 700 ]
[ "$(stat -c %a "$repo/dist/main.js")" = 600 ]
[ "$(stat -c %a "$TEST_ROOT/private.env")" = 600 ]
[ -z "$(find "$release" -type f -perm /0022 -print -quit)" ]
assemble > "$TEST_ROOT/reuse.log" 2>&1

# A failed check must preserve both active pointers, also for reused releases.
mkdir "$runtime/releases/previous"
printf 'previous\n' > "$runtime/releases/previous/BUILD_SHA"
ln -s releases/previous "$runtime/previous-link"
mv -Tf "$runtime/previous-link" "$runtime/current"
printf 'previous\n' > "$runtime/current-revision"
expect_rejection() {
  if assemble > "$TEST_ROOT/rejected.log" 2>&1; then
    echo "错误 release 未在切换前拒绝" >&2; exit 1
  fi
  grep -Fq 'release 服务身份检查失败' "$TEST_ROOT/rejected.log"
  [ "$(readlink "$runtime/current")" = releases/previous ]
  [ "$(cat "$runtime/current-revision")" = previous ]
}
chmod 0700 "$release/dist"
expect_rejection
[ "$(stat -c %a "$release/dist")" = 700 ]
chmod 0750 "$release/dist"
chmod 0600 "$release/dist/image-worker.js"
expect_rejection
chmod 0640 "$release/dist/image-worker.js"
chmod 0600 "$release/node_modules/pino-pretty/index.js"
expect_rejection
chmod 0644 "$release/node_modules/pino-pretty/index.js"
# Module loading (not merely entry test -r) must run for a newly built release.
printf "throw new Error('test module failure');\n" > "$repo/dist/media/image-worker.module.js"
sha=2222222222222222222222222222222222222222
expect_rejection
[ -d "$runtime/releases/$sha" ]
echo "release 权限集成测试通过：077/0700/0600、真实服务身份、复用检查、失败保留当前版本"
