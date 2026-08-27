#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BACKEND_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
CONFIG_ROOT=${WENYOUSITE_CONFIG_ROOT:-/etc/wenyousite}
SECRETS_DIR="$CONFIG_ROOT/secrets"
RUNTIME_ROOT=${WENYOUSITE_RUNTIME_ROOT:-/var/lib/wenyousite/backend}
APP_USER=${WENYOUSITE_APP_USER:-wenyousite-backend}
MIGRATOR_USER=${WENYOUSITE_MIGRATOR_USER:-wenyousite-migrator}
SECRETS_GROUP=${WENYOUSITE_SECRETS_GROUP:-wenyousite-secrets}
RUNTIME_GROUP=${WENYOUSITE_RUNTIME_GROUP:-wenyousite-runtime}

if [ "$(id -u)" -ne 0 ]; then
  echo "必须以 root 运行主机安全配置" >&2
  exit 1
fi

if ! getent group "$SECRETS_GROUP" >/dev/null; then
  groupadd --system "$SECRETS_GROUP"
fi
if ! getent group "$RUNTIME_GROUP" >/dev/null; then
  groupadd --system "$RUNTIME_GROUP"
fi
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "$RUNTIME_ROOT" \
    --shell /usr/sbin/nologin "$APP_USER"
fi
if ! id "$MIGRATOR_USER" >/dev/null 2>&1; then
  useradd --system --user-group --home-dir /nonexistent --shell /usr/sbin/nologin "$MIGRATOR_USER"
fi
getent group "$APP_USER" >/dev/null || { echo "应用私有组不存在: $APP_USER" >&2; exit 1; }
usermod --append --groups "$RUNTIME_GROUP" "$APP_USER"
usermod --append --groups "$RUNTIME_GROUP" "$MIGRATOR_USER"
if id -nG "$MIGRATOR_USER" | tr ' ' '\n' | grep -qx "$APP_USER"; then
  gpasswd --delete "$MIGRATOR_USER" "$APP_USER" >/dev/null
fi

install -d -o root -g root -m 0755 "$CONFIG_ROOT"
install -d -o root -g "$SECRETS_GROUP" -m 0750 "$SECRETS_DIR"
install -d -o root -g "$RUNTIME_GROUP" -m 0750 "$RUNTIME_ROOT" "$RUNTIME_ROOT/releases"
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 /var/log/wenyousite
install -d -o root -g root -m 0700 /var/backups/wenyousite /var/lib/wenyousite/backup-state
install -d -o root -g root -m 0700 /var/cache/wenyousite/restic /var/lib/wenyousite/restore-candidates

install_example() {
  local source=$1
  local target=$2
  local mode=$3
  local group=$4
  if [ ! -e "$target" ]; then
    install -o root -g "$group" -m "$mode" "$source" "$target"
    echo "已创建待填写模板: $target"
  fi
}

install_example "$BACKEND_DIR/ops/secrets/compose.env.example" "$CONFIG_ROOT/compose.env" 0640 "$SECRETS_GROUP"
install_example "$BACKEND_DIR/ops/secrets/database-roles.env.example" "$SECRETS_DIR/database-roles.env" 0640 "$SECRETS_GROUP"
install_example "$BACKEND_DIR/ops/secrets/pgbackrest.conf.example" "$SECRETS_DIR/pgbackrest.conf" 0640 "$SECRETS_GROUP"
install_example "$BACKEND_DIR/ops/secrets/pg_hba.conf.example" "$SECRETS_DIR/pg_hba.conf" 0640 "$SECRETS_GROUP"
install_example "$BACKEND_DIR/ops/secrets/redis-users.acl.example" "$SECRETS_DIR/redis-users.acl" 0640 "$SECRETS_GROUP"
install_example "$BACKEND_DIR/ops/secrets/restic.env.example" "$CONFIG_ROOT/restic.env" 0600 root
install_example "$BACKEND_DIR/ops/secrets/alerts.env.example" "$CONFIG_ROOT/alerts.env" 0600 root

if [ ! -e "$CONFIG_ROOT/backend.env" ]; then
  install -o root -g "$APP_USER" -m 0640 /dev/null "$CONFIG_ROOT/backend.env"
  echo "已创建空运行配置: $CONFIG_ROOT/backend.env（合并现有 .env 与 backend-security.env.example）"
fi
if [ ! -e "$CONFIG_ROOT/migration.env" ]; then
  install -o root -g "$MIGRATOR_USER" -m 0640 \
    "$BACKEND_DIR/ops/secrets/migration.env.example" "$CONFIG_ROOT/migration.env"
  echo "已创建待填写迁移配置: $CONFIG_ROOT/migration.env"
fi
if [ ! -e "$SECRETS_DIR/redis-ops-password" ]; then
  install -o root -g "$SECRETS_GROUP" -m 0640 /dev/null "$SECRETS_DIR/redis-ops-password"
fi
if [ ! -e "$SECRETS_DIR/redis-health-password" ]; then
  install -o root -g "$SECRETS_GROUP" -m 0640 /dev/null "$SECRETS_DIR/redis-health-password"
fi
if [ ! -e "$SECRETS_DIR/postgres-owner-password" ]; then
  install -o root -g "$SECRETS_GROUP" -m 0640 /dev/null "$SECRETS_DIR/postgres-owner-password"
fi
if [ ! -e "$SECRETS_DIR/postgres-backup-password" ]; then
  install -o root -g "$SECRETS_GROUP" -m 0640 /dev/null "$SECRETS_DIR/postgres-backup-password"
fi
if [ ! -e "$CONFIG_ROOT/restic-password" ]; then
  install -o root -g root -m 0600 /dev/null "$CONFIG_ROOT/restic-password"
fi

secrets_gid=$(getent group "$SECRETS_GROUP" | cut -d: -f3)
echo "主机目录已就绪；将 compose.env 的 WENYOUSITE_SECRETS_GID 设置为 $secrets_gid。"
echo "脚本不会生成、打印或覆盖密码。可运行 generate-data-security-secrets.sh --apply 生成内部口令，外部配置仍需手工填写。"
