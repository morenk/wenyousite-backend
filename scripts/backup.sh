#!/bin/bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BACKEND_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE="$BACKEND_DIR/docker-compose.yml"
BACKUP_DIR="$BACKEND_DIR/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/wenyousite_$TIMESTAMP.sql.gz"
TEMP_FILE="$BACKUP_FILE.tmp"

mkdir -p "$BACKUP_DIR"
trap 'rm -f "$TEMP_FILE"' EXIT

POSTGRES_CONTAINER=$(docker compose -f "$COMPOSE_FILE" ps -q postgres)
if [ -z "$POSTGRES_CONTAINER" ] || [ "$(docker inspect -f '{{.State.Running}}' "$POSTGRES_CONTAINER")" != "true" ]; then
  echo "PostgreSQL 容器未运行；请先在 $BACKEND_DIR 执行 docker compose up -d --wait" >&2
  exit 1
fi
if [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$POSTGRES_CONTAINER")" != "healthy" ]; then
  echo "PostgreSQL 容器尚未健康；请先检查 docker compose ps 和容器日志" >&2
  exit 1
fi

echo "备份数据库到 $BACKUP_FILE ..."
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U wenyou wenyousite | gzip > "$TEMP_FILE"

gzip -t "$TEMP_FILE"
if [ "$(stat -c %s "$TEMP_FILE")" -le 100 ]; then
  echo "备份文件异常过小，拒绝保留" >&2
  exit 1
fi
mv "$TEMP_FILE" "$BACKUP_FILE"
trap - EXIT

echo "备份完成: $(du -h "$BACKUP_FILE" | cut -f1)"
find "$BACKUP_DIR" -type f -name "wenyousite_*.sql.gz" -mtime +7 -delete
echo "清理 7 天前的旧备份"
