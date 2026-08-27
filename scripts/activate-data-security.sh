#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BACKEND_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE="$BACKEND_DIR/docker-compose.yml"
CONFIG_ROOT=${WENYOUSITE_CONFIG_ROOT:-/etc/wenyousite}
COMPOSE_ENV=${WENYOUSITE_COMPOSE_ENV:-$CONFIG_ROOT/compose.env}
INITIALIZE_RESTIC=false

usage() { echo "用法: $0 --apply [--initialize-restic]" >&2; }
[ "$#" -ge 1 ] && [ "$1" = --apply ] || { usage; exit 2; }
shift
if [ "$#" -eq 1 ] && [ "$1" = --initialize-restic ]; then INITIALIZE_RESTIC=true
elif [ "$#" -ne 0 ]; then usage; exit 2
fi
[ "$(id -u)" -eq 0 ] || { echo "首次安全激活必须以 root 运行" >&2; exit 1; }
[ ! -f /var/lib/wenyousite/backup-state/security-activated ] || {
  echo "数据安全已激活；后续使用 deploy.sh" >&2
  exit 1
}

for command_name in docker flock git jq pnpm restic systemctl; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "缺少命令: $command_name" >&2; exit 1; }
done
bash "$SCRIPT_DIR/validate-production-security.sh"
build_sha=$(bash "$SCRIPT_DIR/assert-releasable-repo.sh" "$BACKEND_DIR" dev)
(cd "$BACKEND_DIR" && pnpm security:audit && pnpm check)
[ "$(bash "$SCRIPT_DIR/assert-releasable-repo.sh" "$BACKEND_DIR" dev)" = "$build_sha" ] || {
  echo "门禁期间后端提交发生变化" >&2
  exit 1
}

set -a
# shellcheck disable=SC1090 -- validated root-owned files.
source "$COMPOSE_ENV"
# shellcheck disable=SC1091
source "$CONFIG_ROOT/restic.env"
set +a

install -d -m 0755 /var/lib/wenyousite
exec 8>/var/lib/wenyousite/data-security-activation.lock
flock -n 8 || { echo "另一次数据安全激活正在进行" >&2; exit 1; }

restic_lock_file=${WENYOUSITE_RESTIC_LOCK:-/run/lock/wenyousite-restic.lock}
install -d -o root -g root -m 0700 "$(dirname -- "$restic_lock_file")"
exec 9>"$restic_lock_file"
flock -w 600 9 || { echo "等待共享 restic 仓库锁超时" >&2; exit 1; }

if restic cat config >/dev/null 2>&1; then
  echo "restic 加密仓库已存在"
elif [ "$INITIALIZE_RESTIC" = true ]; then
  restic init
  restic cat config >/dev/null
else
  echo "restic 仓库不可读；若前缀确定为空，增加 --initialize-restic" >&2
  exit 1
fi
flock -u 9

install -m 0644 "$BACKEND_DIR/ops/99-wenyousite-redis.conf" /etc/sysctl.d/99-wenyousite-redis.conf
sysctl -q -p /etc/sysctl.d/99-wenyousite-redis.conf
[ "$(sysctl -n vm.overcommit_memory)" = 1 ] || { echo "Redis overcommit 前置条件失败" >&2; exit 1; }

for service in postgres redis; do
  container=$(docker compose -f "$COMPOSE_FILE" ps -q "$service")
  [ -n "$container" ] && [ "$(docker inspect -f '{{.State.Running}}' "$container")" = true ] &&
    [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container")" = healthy ] || {
    echo "现有 $service 不健康，拒绝首次激活" >&2
    exit 1
  }
done

echo "生成并异地上传旧数据平面的最后备份..."
WENYOUSITE_OFFSITE_REQUIRED=true bash "$SCRIPT_DIR/backup.sh"
WENYOUSITE_OFFSITE_REQUIRED=true bash "$SCRIPT_DIR/backup-redis.sh"
prechange_backup=$(awk -F= '$1 == "artifact" { print substr($0, index($0, "=") + 1); exit }' \
  /var/lib/wenyousite/backup-state/postgres-logical.success)
[ -f "$prechange_backup" ] && [ -f "$prechange_backup.sha256" ] || { echo "无法定位角色变更前备份" >&2; exit 1; }

# Ensure legacy Redis data is represented by AOF before the ACL-enabled
# container is recreated. Existing AOF installations take the no-op path.
# shellcheck source=backup-common.sh
source "$SCRIPT_DIR/backup-common.sh"
REDIS_CONTAINER=$(docker compose -f "$COMPOSE_FILE" ps -q redis)
appendonly=$(redis_cli "$REDIS_CONTAINER" CONFIG GET appendonly | tail -n 1)
if [ "$appendonly" != yes ]; then
  systemctl stop wenyousite-backend.service || true
  systemctl stop wenyousite-image-worker.service || true
  notification_waiting=$(redis_cli "$REDIS_CONTAINER" LLEN bull:notification:wait)
  notification_active=$(redis_cli "$REDIS_CONTAINER" LLEN bull:notification:active)
  notification_paused=$(redis_cli "$REDIS_CONTAINER" LLEN bull:notification:paused)
  notification_delayed=$(redis_cli "$REDIS_CONTAINER" ZCARD bull:notification:delayed)
  notification_prioritized=$(redis_cli "$REDIS_CONTAINER" ZCARD bull:notification:prioritized)
  notification_waiting_children=$(redis_cli "$REDIS_CONTAINER" ZCARD bull:notification:waiting-children)
  notification_failed=$(redis_cli "$REDIS_CONTAINER" ZCARD bull:notification:failed)
  notification_unresolved=$((
    notification_waiting + notification_active + notification_paused + notification_delayed +
      notification_prioritized + notification_waiting_children + notification_failed
  ))
  if (( notification_unresolved > 0 )); then
    echo "旧通知队列仍有未解决任务，拒绝移除消费者；应用保持停止 waiting=$notification_waiting active=$notification_active paused=$notification_paused delayed=$notification_delayed prioritized=$notification_prioritized waitingChildren=$notification_waiting_children failed=$notification_failed" >&2
    exit 1
  fi
  [ "$(redis_cli "$REDIS_CONTAINER" CONFIG SET appendfsync everysec)" = OK ]
  [ "$(redis_cli "$REDIS_CONTAINER" CONFIG SET maxmemory-policy noeviction)" = OK ]
  [ "$(redis_cli "$REDIS_CONTAINER" CONFIG SET appendonly yes)" = OK ]
  aof_ready=false
  for _attempt in $(seq 1 120); do
    persistence=$(redis_cli "$REDIS_CONTAINER" INFO persistence | tr -d '\r')
    if grep -q '^aof_enabled:1$' <<<"$persistence" &&
      grep -q '^aof_rewrite_in_progress:0$' <<<"$persistence" &&
      grep -q '^aof_rewrite_scheduled:0$' <<<"$persistence" &&
      grep -q '^aof_last_bgrewrite_status:ok$' <<<"$persistence" &&
      grep -q '^aof_last_write_status:ok$' <<<"$persistence"; then
      aof_size=$(awk -F: '$1 == "aof_current_size" { print $2 }' <<<"$persistence")
      if [[ "$aof_size" =~ ^[0-9]+$ ]] && (( aof_size > 0 )); then
        aof_ready=true
        break
      fi
    fi
    sleep 1
  done
  [ "$aof_ready" = true ] || { echo "旧 Redis AOF 未成功生成，应用保持停止" >&2; exit 1; }
fi

bash "$SCRIPT_DIR/harden-database-roles.sh" --apply --backup-file "$prechange_backup"
redis_sentinel="wenyousite:activation:aof:$build_sha"
[ "$(redis_cli "$REDIS_CONTAINER" SET "$redis_sentinel" "$build_sha")" = OK ] || {
  echo "无法在安全重建前写入 Redis 哨兵；应用保持停止" >&2
  exit 1
}
docker compose -f "$COMPOSE_FILE" up -d --build --wait postgres redis
REDIS_CONTAINER=$(docker compose -f "$COMPOSE_FILE" ps -q redis)
[ "$(redis_cli "$REDIS_CONTAINER" GET "$redis_sentinel")" = "$build_sha" ] || {
  echo "Redis 安全重建后哨兵缺失；应用保持停止" >&2
  exit 1
}
[ "$(redis_cli "$REDIS_CONTAINER" DEL "$redis_sentinel")" = 1 ]

bash "$SCRIPT_DIR/initialize-backup-repositories.sh" --apply
bash "$SCRIPT_DIR/enable-postgres-checksums.sh" --apply
bash "$SCRIPT_DIR/backup-postgres-physical.sh" full
bash "$SCRIPT_DIR/restic-maintenance.sh"
bash "$SCRIPT_DIR/validate-running-data-security.sh"
bash "$SCRIPT_DIR/restore-drill.sh"

install -d -o root -g root -m 0700 /var/lib/wenyousite/backup-state
activation_marker=/var/lib/wenyousite/backup-state/security-activated
activation_temp=$(mktemp /var/lib/wenyousite/backup-state/.security-activated.XXXXXX)
printf 'activated_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$activation_temp"
chmod 0600 "$activation_temp"
mv -f -- "$activation_temp" "$activation_marker"

echo "首次数据安全激活完成；进入标准不可变部署..."
exec bash "$SCRIPT_DIR/deploy.sh" --backend-only
