#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BACKEND_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE="$BACKEND_DIR/docker-compose.yml"
BACKUP_DIR="$BACKEND_DIR/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/wenyousite_redis_$TIMESTAMP.rdb"
TEMP_FILE="$BACKUP_FILE.tmp"

mkdir -p "$BACKUP_DIR"
trap 'rm -f -- "$TEMP_FILE"' EXIT

REDIS_CONTAINER=$(docker compose -f "$COMPOSE_FILE" ps -q redis)
if [[ -z "$REDIS_CONTAINER" ]] || [[ "$(docker inspect -f '{{.State.Running}}' "$REDIS_CONTAINER")" != "true" ]]; then
  echo "Redis 容器未运行，拒绝备份" >&2
  exit 1
fi
if [[ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$REDIS_CONTAINER")" != "healthy" ]]; then
  echo "Redis 容器尚未健康，拒绝备份" >&2
  exit 1
fi

previous_persistence=$(docker exec "$REDIS_CONTAINER" redis-cli --raw INFO persistence | tr -d '\r')
previous_saves=$(awk -F: '$1 == "rdb_saves" { print $2 }' <<<"$previous_persistence")
if [[ ! "$previous_saves" =~ ^[0-9]+$ ]]; then
  echo "无法读取 Redis rdb_saves 计数，拒绝备份" >&2
  exit 1
fi
bgsave_output=$(docker exec "$REDIS_CONTAINER" redis-cli --raw BGSAVE 2>&1 || true)
if [[ "$bgsave_output" != "Background saving started" && "$bgsave_output" != *"already in progress"* ]]; then
  echo "Redis BGSAVE 启动失败: $bgsave_output" >&2
  exit 1
fi

completed=false
for _attempt in $(seq 1 60); do
  persistence=$(docker exec "$REDIS_CONTAINER" redis-cli --raw INFO persistence | tr -d '\r')
  current_saves=$(awk -F: '$1 == "rdb_saves" { print $2 }' <<<"$persistence")
  if grep -q '^rdb_bgsave_in_progress:0$' <<<"$persistence" &&
    grep -q '^rdb_last_bgsave_status:ok$' <<<"$persistence" &&
    [[ "$current_saves" =~ ^[0-9]+$ ]] &&
    (( current_saves > previous_saves )); then
    completed=true
    break
  fi
  sleep 1
done
if [[ "$completed" != "true" ]]; then
  echo "Redis BGSAVE 未在 60 秒内成功完成" >&2
  exit 1
fi

docker exec "$REDIS_CONTAINER" redis-check-rdb /data/dump.rdb >/dev/null
docker cp "$REDIS_CONTAINER:/data/dump.rdb" "$TEMP_FILE" >/dev/null
if [[ ! -s "$TEMP_FILE" ]]; then
  echo "Redis 备份为空，拒绝保留" >&2
  exit 1
fi
mv -- "$TEMP_FILE" "$BACKUP_FILE"
trap - EXIT

echo "Redis 备份完成: $BACKUP_FILE sha256=$(sha256sum "$BACKUP_FILE" | cut -d' ' -f1)"
find "$BACKUP_DIR" -type f -name 'wenyousite_redis_*.rdb' -mtime +7 -delete
