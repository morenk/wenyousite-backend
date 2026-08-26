#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BACKEND_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE="$BACKEND_DIR/docker-compose.yml"
DEPLOY_SCRIPT="$SCRIPT_DIR/deploy.sh"
BACKUP_SCRIPT="$SCRIPT_DIR/backup-redis.sh"
SYSCTL_CONFIG="$BACKEND_DIR/ops/99-wenyousite-redis.conf"

rendered=$(docker compose -f "$COMPOSE_FILE" config)
for expected in 'appendonly' 'yes' 'appendfsync' 'everysec' 'noeviction'; do
  if ! grep -q -- "$expected" <<<"$rendered"; then
    echo "Redis Compose 缺少持久化配置: $expected" >&2
    exit 1
  fi
done

backup_line=$(grep -n 'bash scripts/backup-redis.sh' "$DEPLOY_SCRIPT" | head -n 1 | cut -d: -f1)
sysctl_line=$(grep -n 'sysctl -q -p "$REDIS_SYSCTL_TARGET"' "$DEPLOY_SCRIPT" | head -n 1 | cut -d: -f1)
aof_enable_line=$(grep -n 'CONFIG SET appendonly yes' "$DEPLOY_SCRIPT" | head -n 1 | cut -d: -f1)
compose_line=$(grep -n 'docker compose -f "$COMPOSE_FILE" up -d --wait' "$DEPLOY_SCRIPT" | head -n 1 | cut -d: -f1)
if [[ -z "$sysctl_line" || -z "$backup_line" ]] || (( sysctl_line >= backup_line )); then
  echo "部署脚本没有在 Redis 备份前应用内核持久化前置条件" >&2
  exit 1
fi
if [[ -z "$backup_line" || -z "$compose_line" ]] || (( backup_line >= compose_line )); then
  echo "部署脚本没有在 Compose 变更前备份 Redis" >&2
  exit 1
fi

if ! grep -Eq '^vm\.overcommit_memory[[:space:]]*=[[:space:]]*1$' "$SYSCTL_CONFIG" ||
  ! grep -q 'sysctl -n vm.overcommit_memory' "$DEPLOY_SCRIPT"; then
  echo "Redis 内核持久化前置条件缺失或未验证" >&2
  exit 1
fi
if [[ -z "$aof_enable_line" ]] || (( backup_line >= aof_enable_line || aof_enable_line >= compose_line )); then
  echo "部署脚本没有在备份后、Compose 重建前基于现有数据生成 AOF" >&2
  exit 1
fi

for expected in 'BGSAVE' 'rdb_saves' 'redis-check-rdb' 'sha256sum'; do
  if ! grep -q -- "$expected" "$BACKUP_SCRIPT"; then
    echo "Redis 备份脚本缺少校验步骤: $expected" >&2
    exit 1
  fi
done

if ! grep -q 'bull:notification:wait' "$DEPLOY_SCRIPT" ||
  ! grep -q '旧通知队列仍有未解决任务' "$DEPLOY_SCRIPT"; then
  echo "部署脚本缺少旧通知队列排空门禁" >&2
  exit 1
fi

for expected in 'aof_rewrite_in_progress' 'aof_rewrite_scheduled' 'aof_last_bgrewrite_status' 'aof_current_size'; do
  if ! grep -q -- "$expected" "$DEPLOY_SCRIPT"; then
    echo "部署脚本缺少 AOF 在线生成完成条件: $expected" >&2
    exit 1
  fi
done

bash -n "$DEPLOY_SCRIPT" "$BACKUP_SCRIPT"
echo "Redis durability tests passed"
