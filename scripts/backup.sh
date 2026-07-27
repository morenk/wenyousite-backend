#!/bin/bash
set -e

BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/wenyouzhan_$TIMESTAMP.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "备份数据库到 $BACKUP_FILE ..."
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U wenyou wenyouzhan | gzip > "$BACKUP_FILE"

echo "备份完成: $(du -h "$BACKUP_FILE" | cut -f1)"

# 保留最近 7 天备份
find "$BACKUP_DIR" -name "wenyouzhan_*" -mtime +7 -delete
echo "清理 7 天前的旧备份"
