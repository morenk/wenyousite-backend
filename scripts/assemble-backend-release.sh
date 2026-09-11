#!/usr/bin/env bash
set -euo pipefail
# The release root is 0750 root:wenyousite-runtime. A 0027 umask would make pnpm's
# root-owned node_modules directories inaccessible to the non-root service.
umask 022

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BACKEND_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
RUNTIME_ROOT=${WENYOUSITE_RUNTIME_ROOT:-/var/lib/wenyousite/backend}
APP_USER=${WENYOUSITE_APP_USER:-wenyousite-backend}
RUNTIME_GROUP=${WENYOUSITE_RUNTIME_GROUP:-wenyousite-runtime}
NODE_SOURCE=${WENYOUSITE_NODE_SOURCE:-$(command -v node)}

validate_release_tree() {
  local tree=$1
  [ "$(stat -c %u "$tree")" -eq 0 ] || { echo "release 根目录不是 root 所有: $tree" >&2; return 1; }
  if find "$tree" -xdev \( -type f -o -type d \) ! -user root -print -quit | grep -q .; then
    echo "release 包含非 root 所有的内容: $tree" >&2
    return 1
  fi
  if find "$tree" -xdev \( -type f -o -type d \) -perm /0022 -print -quit | grep -q .; then
    echo "release 包含 group/world 可写内容: $tree" >&2
    return 1
  fi
  while IFS= read -r -d '' link; do
    resolved=$(readlink -f -- "$link") || { echo "release 包含断裂链接: $link" >&2; return 1; }
    [[ "$resolved" = "$tree"/* ]] || { echo "release 链接逃逸目录: $link" >&2; return 1; }
  done < <(find "$tree" -xdev -type l -print0)
}

validate_app_readability() (
  local tree=$1
  cd "$tree"
  # Test the final path as the service identity, without inheriting root secrets
  # or starting Nest, database connections, queues, or HTTP listeners.
  if ! runuser -u "$APP_USER" -- env -i PATH=/usr/bin:/bin NODE_ENV=test \
    "$tree/bin/node" - "$tree" "$build_sha" <<'NODE'
const fs = require('node:fs');
const { createRequire } = require('node:module');
const [tree, sha] = process.argv.slice(2);
try {
  if (process.getuid() === 0) throw new Error('root identity');
  if (fs.readFileSync(`${tree}/BUILD_SHA`, 'utf8').trim() !== sha) throw new Error('revision');
  for (const entry of ['main.js', 'image-worker.js']) fs.readFileSync(`${tree}/dist/${entry}`);
  const load = createRequire(`${tree}/package.json`);
  load.resolve('pino-pretty');
  load.resolve('pino-roll');
  load('./dist/app.module.js');
  load('./dist/media/image-worker.module.js');
} catch {
  console.error('服务身份无法读取 release 入口、revision 或加载 API/Worker 模块');
  process.exit(1);
}
NODE
  then
    echo "release 服务身份检查失败，保留当前版本" >&2
    return 1
  fi
)

[ "$#" -eq 2 ] && [ "$1" = --sha ] || { echo "用法: $0 --sha FULL_GIT_SHA" >&2; exit 2; }
build_sha=$2
[[ "$build_sha" =~ ^[0-9a-f]{40}$ ]] || { echo "release SHA 必须是完整小写 Git SHA" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "release 组装必须以 root 运行" >&2; exit 1; }
id "$APP_USER" >/dev/null 2>&1 || { echo "缺少非 root 运行用户 $APP_USER" >&2; exit 1; }
[ "$(id -u "$APP_USER")" -ne 0 ] || { echo "运行用户不得为 root" >&2; exit 1; }
command -v runuser >/dev/null || { echo "缺少 runuser，无法验证服务身份" >&2; exit 1; }
getent group "$RUNTIME_GROUP" >/dev/null || { echo "缺少共享只读运行组 $RUNTIME_GROUP" >&2; exit 1; }
[ -x "$NODE_SOURCE" ] || { echo "Node 运行时不可执行: $NODE_SOURCE" >&2; exit 1; }
for path in dist/main.js dist/image-worker.js docker docker-compose.yml node_modules package.json pnpm-lock.yaml pnpm-workspace.yaml prisma scripts; do
  [ -e "$BACKEND_DIR/$path" ] || { echo "release 输入缺失: $path" >&2; exit 1; }
done

release_dir="$RUNTIME_ROOT/releases/$build_sha"
install -d -o root -g "$RUNTIME_GROUP" -m 0750 "$RUNTIME_ROOT" "$RUNTIME_ROOT/releases"
if [ ! -d "$release_dir" ]; then
  staging_root=$(mktemp -d "$RUNTIME_ROOT/releases/.${build_sha}.XXXXXX")
  staging_dir="$staging_root/release"
  cleanup() {
    if [ -n "${staging_root:-}" ] && [ -d "$staging_root" ]; then
      case "$staging_root" in
        "$RUNTIME_ROOT"/releases/."$build_sha".*) find "$staging_root" -depth -delete ;;
        *) echo "拒绝清理非 release staging: $staging_root" >&2 ;;
      esac
    fi
  }
  trap cleanup EXIT
  install -d -m 0755 "$staging_dir"
  cp -a -- "$BACKEND_DIR/dist" "$BACKEND_DIR/docker" "$BACKEND_DIR/docker-compose.yml" \
    "$BACKEND_DIR/prisma" "$BACKEND_DIR/scripts" \
    "$BACKEND_DIR/package.json" "$BACKEND_DIR/pnpm-lock.yaml" "$BACKEND_DIR/pnpm-workspace.yaml" \
    "$staging_dir/"
  DATABASE_URL=postgresql://release:release@example.invalid/wenyousite \
    DIRECT_DATABASE_URL=postgresql://release:release@example.invalid/wenyousite \
    SCARF_ANALYTICS=false DO_NOT_TRACK=1 \
    pnpm --dir "$staging_dir" install --prod --offline --frozen-lockfile
  [ -d "$staging_dir/node_modules/prisma" ] || { echo "release 缺少 Prisma migration CLI" >&2; exit 1; }
  if find "$staging_dir" -maxdepth 2 -type f \( -name .env -o -name '*.pem' -o -name '*.key' \) | grep -q .; then
    echo "release 包含禁止的凭据文件" >&2
    exit 1
  fi
  install -d -o root -g "$RUNTIME_GROUP" -m 0750 "$staging_dir/bin"
  install -o root -g "$RUNTIME_GROUP" -m 0750 "$NODE_SOURCE" "$staging_dir/bin/node"
  printf '%s\n' "$build_sha" >"$staging_dir/BUILD_SHA"
  # cp -a preserves the owner of the /srv development checkout. Normalize the
  # complete immutable tree before enforcing the root-owned release invariant.
  chown -R root:"$RUNTIME_GROUP" "$staging_dir"
  chmod -R go-w "$staging_dir"
  chmod 0750 "$staging_dir"
  validate_release_tree "$staging_dir"
  # cp -a also preserves 0700/0600 build inputs. Only copied application assets
  # need group read/traverse repair; dependencies are installed with umask 022.
  for path in dist docker prisma scripts; do
    find "$staging_dir/$path" -type d -exec chmod g+rx {} +
    find "$staging_dir/$path" -type f -exec chmod g+r {} +
  done
  chmod g+r "$staging_dir"/{docker-compose.yml,package.json,pnpm-lock.yaml,pnpm-workspace.yaml}
  mv -- "$staging_dir" "$release_dir"
  find "$staging_root" -depth -delete
  staging_dir=""
  staging_root=""
  trap - EXIT
else
  [ -f "$release_dir/BUILD_SHA" ] && [ "$(<"$release_dir/BUILD_SHA")" = "$build_sha" ] || {
    echo "既有 release 与 SHA 不一致，拒绝覆盖: $release_dir" >&2
    exit 1
  }
  validate_release_tree "$release_dir"
fi

validate_app_readability "$release_dir"

next_link="$RUNTIME_ROOT/.current.$build_sha"
ln -s "releases/$build_sha" "$next_link"
mv -Tf -- "$next_link" "$RUNTIME_ROOT/current"
printf '%s\n' "$build_sha" >"$RUNTIME_ROOT/current-revision"
chown root:"$RUNTIME_GROUP" "$RUNTIME_ROOT/current-revision"
chmod 0640 "$RUNTIME_ROOT/current-revision"
echo "不可变后端 release 已切换: $release_dir"
