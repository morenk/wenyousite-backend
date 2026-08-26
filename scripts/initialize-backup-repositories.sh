#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BACKEND_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE="$BACKEND_DIR/docker-compose.yml"
CONFIG_ROOT=${WENYOUSITE_CONFIG_ROOT:-/etc/wenyousite}
COMPOSE_ENV=${WENYOUSITE_COMPOSE_ENV:-$CONFIG_ROOT/compose.env}
INITIALIZE_RESTIC=false

usage() {
  echo "用法: $0 --apply [--initialize-restic]" >&2
}
[ "$#" -ge 1 ] && [ "$1" = --apply ] || { usage; exit 2; }
shift
if [ "$#" -eq 1 ] && [ "$1" = --initialize-restic ]; then
  INITIALIZE_RESTIC=true
elif [ "$#" -ne 0 ]; then
  usage
  exit 2
fi
[ "$(id -u)" -eq 0 ] || { echo "必须以 root 运行" >&2; exit 1; }

bash "$SCRIPT_DIR/validate-production-security.sh"
set -a
# shellcheck disable=SC1090 -- root-owned files were validated above.
source "$COMPOSE_ENV"
# shellcheck disable=SC1091
source "$CONFIG_ROOT/restic.env"
set +a

RESTIC_LOCK_FILE=${WENYOUSITE_RESTIC_LOCK:-/run/lock/wenyousite-restic.lock}
install -d -o root -g root -m 0700 "$(dirname -- "$RESTIC_LOCK_FILE")"
exec 9>"$RESTIC_LOCK_FILE"
flock -w 600 9 || { echo "等待共享 restic 仓库锁超时" >&2; exit 1; }

if restic cat config >/dev/null 2>&1; then
  echo "restic 仓库已存在且凭据可用"
elif [ "$INITIALIZE_RESTIC" = true ]; then
  restic init
  restic cat config >/dev/null
  echo "restic 加密仓库已初始化"
else
  echo "restic 仓库不可读；若确认该前缀全新，请显式增加 --initialize-restic" >&2
  exit 1
fi
flock -u 9

POSTGRES_CONTAINER=$(docker compose -f "$COMPOSE_FILE" ps -q postgres)
[ -n "$POSTGRES_CONTAINER" ] && [ "$(docker inspect -f '{{.State.Running}}' "$POSTGRES_CONTAINER")" = true ] || {
  echo "PostgreSQL 安全容器尚未运行" >&2
  exit 1
}
PGBACKREST=(docker exec --user postgres "$POSTGRES_CONTAINER" pgbackrest \
  --config=/run/secrets/wenyousite/pgbackrest.conf --stanza=wenyousite)
"${PGBACKREST[@]}" stanza-create
"${PGBACKREST[@]}" check
bash "$SCRIPT_DIR/backup-postgres-physical.sh" full
WENYOUSITE_OFFSITE_REQUIRED=true bash "$SCRIPT_DIR/backup.sh"
WENYOUSITE_OFFSITE_REQUIRED=true bash "$SCRIPT_DIR/backup-redis.sh"

install -d -o root -g root -m 0700 /var/lib/wenyousite/backup-state
marker=/var/lib/wenyousite/backup-state/repositories-initialized
temp_marker=$(mktemp /var/lib/wenyousite/backup-state/.repositories-initialized.XXXXXX)
printf 'initialized_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$temp_marker"
chmod 0600 "$temp_marker"
mv -f -- "$temp_marker" "$marker"
echo "异地仓库、连续归档和首批备份均已验证；尚未写入完整安全激活标记"
