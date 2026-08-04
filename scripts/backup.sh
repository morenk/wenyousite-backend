#!/bin/bash
set -euo pipefail

BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/wenyousite_$TIMESTAMP.sql.gz"
ENV_FILE="${1:-.env.prod}"
COMPOSE_FILE="../docker-compose.yml"

mkdir -p "$BACKUP_DIR"

echo "备份数据库到 $BACKUP_FILE ..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U wenyou wenyousite | gzip > "$BACKUP_FILE"

echo "备份完成: $(du -h "$BACKUP_FILE" | cut -f1)"

# 保留最近 7 天备份
find "$BACKUP_DIR" -name "wenyousite_*" -mtime +7 -delete
echo "清理 7 天前的旧备份"
