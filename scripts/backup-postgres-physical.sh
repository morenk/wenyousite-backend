#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BACKEND_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE="$BACKEND_DIR/docker-compose.yml"
# shellcheck source=backup-common.sh
source "$SCRIPT_DIR/backup-common.sh"

backup_type=${1:-auto}
if [ "$backup_type" = auto ]; then
  if [ "$(date -u +%u)" -eq 7 ]; then backup_type=full; else backup_type=diff; fi
fi
[[ "$backup_type" = full || "$backup_type" = diff ]] || {
  echo "备份类型只能是 auto、full 或 diff" >&2
  exit 2
}

LOCK_FILE=${WENYOUSITE_POSTGRES_PHYSICAL_LOCK:-/run/lock/wenyousite-postgres-physical.lock}
install -d -o root -g root -m 0700 "$(dirname -- "$LOCK_FILE")"
exec 8>"$LOCK_FILE"
flock -n 8 || { echo "已有 pgBackRest 备份正在执行" >&2; exit 1; }

POSTGRES_CONTAINER=$(docker compose -f "$COMPOSE_FILE" ps -q postgres)
[ -n "$POSTGRES_CONTAINER" ] && [ "$(docker inspect -f '{{.State.Running}}' "$POSTGRES_CONTAINER")" = true ] || {
  echo "PostgreSQL 容器未运行" >&2
  exit 1
}

archive_mode=$(docker exec --user postgres "$POSTGRES_CONTAINER" psql --no-psqlrc \
  --username postgres --dbname postgres --tuples-only --no-align --command 'SHOW archive_mode')
[ "$archive_mode" = on ] || { echo "archive_mode 未开启，拒绝制造不可恢复的物理备份假象" >&2; exit 1; }

PGBACKREST=(docker exec --user postgres "$POSTGRES_CONTAINER" pgbackrest \
  --config=/run/secrets/wenyousite/pgbackrest.conf --stanza=wenyousite)
"${PGBACKREST[@]}" check
"${PGBACKREST[@]}" backup --type="$backup_type"
info_json=$("${PGBACKREST[@]}" info --output=json)
latest_status=$(jq -r '.[0].status.code // -1' <<<"$info_json")
latest_label=$(jq -r '.[0].backup[-1].label // empty' <<<"$info_json")
[ "$latest_status" = 0 ] && [ -n "$latest_label" ] || { echo "pgBackRest 最新备份状态异常" >&2; exit 1; }
record_backup_success pgbackrest "$latest_label"
echo "pgBackRest $backup_type 备份完成: $latest_label"
