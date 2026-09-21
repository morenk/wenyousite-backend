#!/usr/bin/env bash
# 仅安装离线发行包中的测试二进制；不启动系统服务，不复制数据库目录或任何凭据。
set -euo pipefail
if [ "$#" -ne 2 ] || [ "$1" != '--source-root' ]; then
  echo '用法：管理身份 bash scripts/prepare-e2e-tools.sh --source-root <已校验发行包解压根目录>' >&2
  exit 1
fi
[ "$(id -u)" = 0 ] || { echo '只允许管理身份安装只读工具' >&2; exit 1; }
source_root=$(realpath -- "$2")
destination=/opt/wenyousite/e2e-tools
[ ! -e "$destination" ] || { echo '目标已存在；不覆盖、不接管既有安装' >&2; exit 1; }
[ -x "$source_root/usr/lib/postgresql/16/bin/initdb" ]
[ -x "$source_root/usr/lib/postgresql/16/bin/postgres" ]
[ -x "$source_root/usr/bin/redis-server" ]
# source-root 必须是治理校验过的包解压根；只复制静态发行文件，绝不复制 pg-data/redis-data。
install -d -m 0755 "$destination/usr/bin" "$destination/usr/lib" "$destination/usr/share"
cp -a -- "$source_root/usr/lib/postgresql" "$destination/usr/lib/"
cp -a -- "$source_root/usr/share/postgresql" "$destination/usr/share/"
cp -L -- "$source_root/usr/bin/redis-server" "$destination/usr/bin/redis-server"
if [ -d "$source_root/usr/lib/x86_64-linux-gnu" ]; then
  cp -a -- "$source_root/usr/lib/x86_64-linux-gnu" "$destination/usr/lib/"
fi
chown -R root:root "$destination"
chmod -R go-w "$destination"
"$destination/usr/lib/postgresql/16/bin/postgres" --version
LD_LIBRARY_PATH="$destination/usr/lib/x86_64-linux-gnu" "$destination/usr/bin/redis-server" --version
cat <<'CONFIG'
E2E_PG_BIN=/opt/wenyousite/e2e-tools/usr/lib/postgresql/16/bin
E2E_REDIS_BIN=/opt/wenyousite/e2e-tools/usr/bin/redis-server
E2E_LIBRARY_PATH=/opt/wenyousite/e2e-tools/usr/lib/x86_64-linux-gnu
CONFIG
