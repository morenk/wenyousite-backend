#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BACKEND_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE="$BACKEND_DIR/docker-compose.yml"
CONFIG_ROOT=${WENYOUSITE_CONFIG_ROOT:-/etc/wenyousite}
COMPOSE_ENV=${WENYOUSITE_COMPOSE_ENV:-$CONFIG_ROOT/compose.env}
CANDIDATE_DIR=${WENYOUSITE_RESTORE_CANDIDATE_DIR:-/var/lib/wenyousite/restore-candidates}
DEPLOY_LOCK_FILE=${WENYOU_DEPLOY_LOCK_FILE:-/var/lib/wenyousite/deploy.lock}

usage() {
  echo "用法: $0 --candidate CANDIDATE_ID --confirm ACTIVATE_WENYOUSITE_RESTORE" >&2
}
[ "$#" -eq 4 ] && [ "$1" = --candidate ] && [ "$3" = --confirm ] && \
  [ "$4" = ACTIVATE_WENYOUSITE_RESTORE ] || { usage; exit 2; }
candidate_id=$2
[[ "$candidate_id" =~ ^[0-9]{8}t[0-9]{6}z_[0-9a-f]{8}$ ]] || { echo "候选 ID 非法" >&2; exit 2; }
[ "$(id -u)" -eq 0 ] || { echo "恢复切换必须以 root 运行" >&2; exit 1; }
install -d -o root -g root -m 0755 "$(dirname -- "$DEPLOY_LOCK_FILE")"
exec 8>"$DEPLOY_LOCK_FILE"
flock -n 8 || { echo "部署或另一次恢复切换正在进行" >&2; exit 1; }

bash "$SCRIPT_DIR/validate-production-security.sh"
manifest="$CANDIDATE_DIR/$candidate_id.env"
[ -f "$manifest" ] && [ "$(stat -c %u "$manifest")" -eq 0 ] && [ "$(stat -c %a "$manifest")" = 600 ] || {
  echo "恢复候选 manifest 缺失或权限错误: $manifest" >&2
  exit 1
}
manifest_value() {
  local key=$1
  awk -F= -v key="$key" '$1 == key { print substr($0, index($0, "=") + 1); exit }' "$manifest"
}
[ "$(manifest_value candidate_id)" = "$candidate_id" ] || { echo "候选 manifest ID 不一致" >&2; exit 1; }
[ "$(manifest_value status)" = validated ] || { echo "只有 validated 候选可切换" >&2; exit 1; }
target_utc=$(manifest_value target_utc)
pg_volume=$(manifest_value postgres_volume)
redis_volume=$(manifest_value redis_volume)
[[ "$pg_volume" = "wenyousite_pgdata_restore_$candidate_id" ]] || { echo "PostgreSQL 候选卷名不一致" >&2; exit 1; }
[[ "$redis_volume" = "wenyousite_redisdata_restore_$candidate_id" ]] || { echo "Redis 候选卷名不一致" >&2; exit 1; }
for volume in "$pg_volume" "$redis_volume"; do
  [ "$(docker volume inspect -f '{{index .Labels "com.wenyousite.restore-candidate"}}' "$volume")" = true ] || {
    echo "卷不是受控恢复候选: $volume" >&2
    exit 1
  }
  [ "$(docker volume inspect -f '{{index .Labels "com.wenyousite.restore-id"}}' "$volume")" = "$candidate_id" ] || {
    echo "卷标签候选 ID 不一致: $volume" >&2
    exit 1
  }
  [ "$(docker volume inspect -f '{{index .Labels "com.wenyousite.restore-target"}}' "$volume")" = "$target_utc" ] || {
    echo "卷标签目标时间不一致: $volume" >&2
    exit 1
  }
done

set -a
# shellcheck disable=SC1090 -- validated root-owned configuration.
source "$COMPOSE_ENV"
set +a
old_pg_volume=$POSTGRES_VOLUME
old_redis_volume=$REDIS_VOLUME
[[ "$old_pg_volume" =~ ^wenyousite_[a-z0-9_]+$ ]] || { echo "当前 PostgreSQL 卷名非法" >&2; exit 1; }
[[ "$old_redis_volume" =~ ^wenyousite_[a-z0-9_]+$ ]] || { echo "当前 Redis 卷名非法" >&2; exit 1; }
[ "$old_pg_volume" != "$pg_volume" ] && [ "$old_redis_volume" != "$redis_volume" ] || {
  echo "恢复候选已经是当前活动卷" >&2
  exit 1
}

echo "切换前生成最后一组异地安全备份..."
bash "$SCRIPT_DIR/backup-postgres-physical.sh" diff
WENYOUSITE_OFFSITE_REQUIRED=true bash "$SCRIPT_DIR/backup.sh"
WENYOUSITE_OFFSITE_REQUIRED=true bash "$SCRIPT_DIR/backup-redis.sh"

for unit in wenyousite-backend.service wenyousite-image-worker.service; do
  if systemctl list-unit-files "$unit" --no-legend 2>/dev/null | grep -q "^$unit"; then
    systemctl stop "$unit"
  fi
done

rollback_manifest="$CANDIDATE_DIR/rollback_$(date -u +%Y%m%dT%H%M%SZ).env"
rollback_temp=$(mktemp "$CANDIDATE_DIR/.rollback.XXXXXX")
{
  printf 'status=previous-active\n'
  printf 'postgres_volume=%s\n' "$old_pg_volume"
  printf 'redis_volume=%s\n' "$old_redis_volume"
  printf 'replaced_by=%s\n' "$candidate_id"
  printf 'created_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} >"$rollback_temp"
chmod 0600 "$rollback_temp"
mv -- "$rollback_temp" "$rollback_manifest"

replace_active_volumes() {
  local temp
  temp=$(mktemp "$(dirname -- "$COMPOSE_ENV")/.compose.env.XXXXXX")
  awk -v postgres_volume="$pg_volume" -v redis_volume="$redis_volume" '
    BEGIN { postgres_found = 0; redis_found = 0 }
    /^POSTGRES_VOLUME=/ { print "POSTGRES_VOLUME=" postgres_volume; postgres_found++; next }
    /^REDIS_VOLUME=/ { print "REDIS_VOLUME=" redis_volume; redis_found++; next }
    { print }
    END { if (postgres_found != 1 || redis_found != 1) exit 42 }
  ' "$COMPOSE_ENV" >"$temp" || {
    rm -f -- "$temp"
    echo "$COMPOSE_ENV 中两个活动卷都必须且只能出现一次" >&2
    exit 1
  }
  chown --reference="$COMPOSE_ENV" "$temp"
  chmod --reference="$COMPOSE_ENV" "$temp"
  mv -f -- "$temp" "$COMPOSE_ENV"
}
replace_active_volumes
export POSTGRES_VOLUME=$pg_volume
export REDIS_VOLUME=$redis_volume

docker compose -f "$COMPOSE_FILE" stop postgres redis
docker compose -f "$COMPOSE_FILE" up -d --wait postgres redis

POSTGRES_CONTAINER=$(docker compose -f "$COMPOSE_FILE" ps -q postgres)
REDIS_CONTAINER=$(docker compose -f "$COMPOSE_FILE" ps -q redis)
checksum_state=$(docker exec --user postgres "$POSTGRES_CONTAINER" psql --no-psqlrc \
  --username postgres --dbname postgres --tuples-only --no-align --command 'SHOW data_checksums')
[ "$checksum_state" = on ] || { echo "候选 PostgreSQL data checksums 未启用；应用保持停止" >&2; exit 1; }
unfinished_migrations=$(docker exec --user postgres "$POSTGRES_CONTAINER" psql --no-psqlrc \
  --username postgres --dbname wenyousite --tuples-only --no-align --command \
  'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL')
[ "$unfinished_migrations" = 0 ] || { echo "候选数据库有未完成 migration；应用保持停止" >&2; exit 1; }

# shellcheck source=backup-common.sh
source "$SCRIPT_DIR/backup-common.sh"
redis_persistence=$(redis_cli "$REDIS_CONTAINER" INFO persistence | tr -d '\r')
grep -q '^aof_enabled:1$' <<<"$redis_persistence" && \
  grep -q '^aof_last_write_status:ok$' <<<"$redis_persistence" || {
  echo "候选 Redis AOF 状态异常；应用保持停止" >&2
  exit 1
}
non_bull_count=$(redis_cli "$REDIS_CONTAINER" EVAL \
  'local c="0" local n=0 repeat local r=redis.call("SCAN",c,"COUNT",1000) c=r[1] for _,k in ipairs(r[2]) do if string.sub(k,1,5)~="bull:" then n=n+1 end end until c=="0" return n' 0)
[ "$non_bull_count" = 0 ] || { echo "候选 Redis 出现非 BullMQ 派生键；应用保持停止" >&2; exit 1; }

systemctl start wenyousite-database-migrate.service
systemctl start wenyousite-image-worker.service
systemctl start wenyousite-backend.service

healthy=false
for _attempt in $(seq 1 60); do
  if curl --fail --silent --max-time 5 http://127.0.0.1:3000/api/v1/health >/dev/null 2>&1; then
    healthy=true
    break
  fi
  sleep 1
done
if [ "$healthy" != true ]; then
  systemctl stop wenyousite-backend.service wenyousite-image-worker.service
  echo "恢复切换后 API 未通过健康检查；候选卷保持活动，旧卷未删除: $old_pg_volume $old_redis_volume" >&2
  exit 1
fi
bash "$SCRIPT_DIR/validate-running-data-security.sh"

status_temp=$(mktemp "$CANDIDATE_DIR/.status.$candidate_id.XXXXXX")
awk '$0 == "status=validated" { print "status=activated"; next } { print }' "$manifest" >"$status_temp"
printf 'activated_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$status_temp"
chmod 0600 "$status_temp"
mv -- "$status_temp" "$manifest"
echo "恢复候选已显式切换并通过健康检查。旧卷仍保留且未覆盖。"
printf 'TARGET_UTC=%s\n' "$target_utc"
printf 'ROLLBACK_MANIFEST=%s\n' "$rollback_manifest"
