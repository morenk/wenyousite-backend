#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BACKEND_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE="$BACKEND_DIR/docker-compose.yml"
# shellcheck source=backup-common.sh
source "$SCRIPT_DIR/backup-common.sh"

BACKUP_DIR="$BACKUP_ROOT/redis"
LOCK_FILE=${WENYOUSITE_REDIS_BACKUP_LOCK:-/run/lock/wenyousite-redis-backup.lock}
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_FILE="$BACKUP_DIR/wenyousite_redis_$TIMESTAMP.rdb"
TEMP_FILE="$BACKUP_FILE.partial"
SHA_FILE="$BACKUP_FILE.sha256"

install -d -o root -g root -m 0700 "$BACKUP_DIR" "$(dirname -- "$LOCK_FILE")"
exec 8>"$LOCK_FILE"
flock -n 8 || { echo "已有 Redis 备份正在执行" >&2; exit 1; }
trap 'if [ -f "$TEMP_FILE" ]; then rm -f -- "$TEMP_FILE"; fi' EXIT

REDIS_CONTAINER=$(docker compose -f "$COMPOSE_FILE" ps -q redis)
if [ -z "$REDIS_CONTAINER" ] || [ "$(docker inspect -f '{{.State.Running}}' "$REDIS_CONTAINER")" != true ]; then
  echo "Redis 容器未运行，拒绝备份" >&2
  exit 1
fi
if [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$REDIS_CONTAINER")" != healthy ]; then
  echo "Redis 容器不健康，拒绝备份" >&2
  exit 1
fi

previous_persistence=$(redis_cli "$REDIS_CONTAINER" INFO persistence | tr -d '\r')
previous_saves=$(awk -F: '$1 == "rdb_saves" { print $2 }' <<<"$previous_persistence")
[[ "$previous_saves" =~ ^[0-9]+$ ]] || { echo "无法读取 Redis rdb_saves" >&2; exit 1; }
bgsave_output=$(redis_cli "$REDIS_CONTAINER" BGSAVE 2>&1 || true)
if [ "$bgsave_output" != "Background saving started" ] && [[ "$bgsave_output" != *"already in progress"* ]]; then
  echo "Redis BGSAVE 启动失败: $bgsave_output" >&2
  exit 1
fi

completed=false
for _attempt in $(seq 1 60); do
  persistence=$(redis_cli "$REDIS_CONTAINER" INFO persistence | tr -d '\r')
  current_saves=$(awk -F: '$1 == "rdb_saves" { print $2 }' <<<"$persistence")
  if grep -q '^rdb_bgsave_in_progress:0$' <<<"$persistence" &&
    grep -q '^rdb_last_bgsave_status:ok$' <<<"$persistence" &&
    [[ "$current_saves" =~ ^[0-9]+$ ]] && (( current_saves > previous_saves )); then
    completed=true
    break
  fi
  sleep 1
done
[ "$completed" = true ] || { echo "Redis BGSAVE 未在 60 秒内成功完成" >&2; exit 1; }

docker exec "$REDIS_CONTAINER" redis-check-rdb /data/dump.rdb >/dev/null
docker cp "$REDIS_CONTAINER:/data/dump.rdb" "$TEMP_FILE" >/dev/null
[ -s "$TEMP_FILE" ] || { echo "Redis 备份为空" >&2; exit 1; }
mv -- "$TEMP_FILE" "$BACKUP_FILE"
(cd -- "$BACKUP_DIR" && sha256sum "$(basename -- "$BACKUP_FILE")" >"$(basename -- "$SHA_FILE")")
(cd -- "$BACKUP_DIR" && sha256sum --check --status "$(basename -- "$SHA_FILE")")

restic_backup_files redis "$BACKUP_FILE" "$SHA_FILE"
record_backup_success redis "$BACKUP_FILE"

find "$BACKUP_DIR" -type f \( -name 'wenyousite_redis_*.rdb' -o -name 'wenyousite_redis_*.rdb.sha256' \) -mtime +7 -delete
trap - EXIT
echo "Redis 备份完成: $BACKUP_FILE"
printf 'BACKUP_FILE=%s\n' "$BACKUP_FILE"
