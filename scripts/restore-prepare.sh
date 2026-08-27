#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BACKEND_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE="$BACKEND_DIR/docker-compose.yml"
CONFIG_ROOT=${WENYOUSITE_CONFIG_ROOT:-/etc/wenyousite}
COMPOSE_ENV=${WENYOUSITE_COMPOSE_ENV:-$CONFIG_ROOT/compose.env}
SECRETS_DIR="$CONFIG_ROOT/secrets"
CANDIDATE_DIR=${WENYOUSITE_RESTORE_CANDIDATE_DIR:-/var/lib/wenyousite/restore-candidates}
REDIS_IMAGE=redis@sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2
validation_postgres=""
validation_redis=""

usage() {
  echo "用法: $0 --target YYYY-MM-DDTHH:MM:SSZ [--postgres-target-name wenyousite_drill_YYYYMMDDTHHMMSSZ]" >&2
}
[ "$#" -eq 2 ] || [ "$#" -eq 4 ] || { usage; exit 2; }
[ "$1" = --target ] || { usage; exit 2; }
target_utc=$2
postgres_target_name=""
if [ "$#" -eq 4 ]; then
  [ "$3" = --postgres-target-name ] || { usage; exit 2; }
  postgres_target_name=$4
  [[ "$postgres_target_name" =~ ^wenyousite_drill_[0-9]{8}T[0-9]{6}Z$ ]] || {
    echo "PostgreSQL 命名恢复点非法" >&2
    exit 2
  }
fi
[[ "$target_utc" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || {
  echo "恢复目标必须是 UTC RFC3339 秒精度" >&2
  exit 2
}
target_epoch=$(date -u -d "$target_utc" +%s 2>/dev/null) || { echo "无效恢复目标时间" >&2; exit 2; }
(( target_epoch <= $(date +%s) )) || { echo "恢复目标不能在未来" >&2; exit 2; }
pgbackrest_target_type=time
pgbackrest_target=$(date -u -d "$target_utc" '+%Y-%m-%d %H:%M:%S+00')
[[ "$pgbackrest_target" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}\+00$ ]] || {
  echo "无法生成 pgBackRest 恢复目标时间" >&2
  exit 2
}
if [ -n "$postgres_target_name" ]; then
  pgbackrest_target_type=name
  pgbackrest_target=$postgres_target_name
fi
[ "$(id -u)" -eq 0 ] || { echo "恢复准备必须以 root 运行" >&2; exit 1; }

bash "$SCRIPT_DIR/validate-production-security.sh"
set -a
# shellcheck disable=SC1090 -- production preflight validated root ownership and modes.
source "$COMPOSE_ENV"
# shellcheck disable=SC1091
source "$CONFIG_ROOT/restic.env"
set +a
# shellcheck source=backup-common.sh
source "$SCRIPT_DIR/backup-common.sh"

compact_target=$(date -u -d "$target_utc" +%Y%m%dt%H%M%Sz)
candidate_id="${compact_target}_$(openssl rand -hex 4)"
[[ "$candidate_id" =~ ^[0-9]{8}t[0-9]{6}z_[0-9a-f]{8}$ ]] || exit 1
pg_volume="wenyousite_pgdata_restore_$candidate_id"
redis_volume="wenyousite_redisdata_restore_$candidate_id"
work_dir="$CANDIDATE_DIR/.work_$candidate_id"
manifest="$CANDIDATE_DIR/$candidate_id.env"

cleanup_validation_containers() {
  for container in "$validation_postgres" "$validation_redis"; do
    if [ -n "$container" ] && [[ "$container" =~ ^wenyousite-restore-[a-z]+-[0-9a-z_]+$ ]] &&
      docker container inspect "$container" >/dev/null 2>&1; then
      docker stop --time 30 "$container" >/dev/null 2>&1 || true
      docker rm "$container" >/dev/null 2>&1 || true
    fi
  done
}
trap cleanup_validation_containers EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

install -d -o root -g root -m 0700 "$CANDIDATE_DIR" "$work_dir"
docker volume create \
  --label com.wenyousite.restore-candidate=true \
  --label "com.wenyousite.restore-id=$candidate_id" \
  --label "com.wenyousite.restore-target=$target_utc" \
  "$pg_volume" >/dev/null
docker volume create \
  --label com.wenyousite.restore-candidate=true \
  --label "com.wenyousite.restore-id=$candidate_id" \
  --label "com.wenyousite.restore-target=$target_utc" \
  "$redis_volume" >/dev/null
preparing_manifest=$(mktemp "$CANDIDATE_DIR/.manifest.$candidate_id.XXXXXX")
{
  printf 'candidate_id=%s\n' "$candidate_id"
  printf 'status=preparing\n'
  printf 'target_utc=%s\n' "$target_utc"
  printf 'postgres_target_type=%s\n' "$pgbackrest_target_type"
  printf 'postgres_target=%s\n' "$pgbackrest_target"
  printf 'postgres_volume=%s\n' "$pg_volume"
  printf 'redis_volume=%s\n' "$redis_volume"
  printf 'prepared_started_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} >"$preparing_manifest"
chmod 0600 "$preparing_manifest"
mv -- "$preparing_manifest" "$manifest"
printf 'CANDIDATE_ID=%s\n' "$candidate_id"

postgres_image=$(docker compose -f "$COMPOSE_FILE" images -q postgres)
[ -n "$postgres_image" ] || { echo "缺少已构建的 PostgreSQL/pgBackRest 镜像" >&2; exit 1; }
docker run --rm --user root --volume "$pg_volume:/var/lib/postgresql/data" \
  "$postgres_image" sh -eu -c 'chown -R postgres:postgres /var/lib/postgresql/data'
docker run --rm --user postgres --group-add "$WENYOUSITE_SECRETS_GID" \
  --volume "$pg_volume:/var/lib/postgresql/data" \
  --volume "$SECRETS_DIR/pgbackrest.conf:/run/secrets/wenyousite/pgbackrest.conf:ro" \
  "$postgres_image" pgbackrest \
  --config=/run/secrets/wenyousite/pgbackrest.conf --stanza=wenyousite \
  --type="$pgbackrest_target_type" --target="$pgbackrest_target" \
  --target-action=promote --archive-mode=off restore

validation_postgres="wenyousite-restore-postgres-$candidate_id"
# No port is published and PostgreSQL listens only on its Unix socket. The
# container still needs outbound HTTPS so restore_command can fetch WAL.
docker run --detach --name "$validation_postgres" \
  --user postgres \
  --group-add "$WENYOUSITE_SECRETS_GID" \
  --volume "$pg_volume:/var/lib/postgresql/data" \
  --volume "$SECRETS_DIR/pg_hba.conf:/run/secrets/wenyousite/pg_hba.conf:ro" \
  --volume "$SECRETS_DIR/pgbackrest.conf:/run/secrets/wenyousite/pgbackrest.conf:ro" \
  "$postgres_image" postgres -c listen_addresses= -c archive_mode=off \
  -c hba_file=/run/secrets/wenyousite/pg_hba.conf >/dev/null
postgres_ready=false
for _attempt in $(seq 1 180); do
  recovery_state=$(docker exec --user postgres "$validation_postgres" psql --no-psqlrc \
    --username postgres --dbname postgres --tuples-only --no-align \
    --command 'SELECT pg_is_in_recovery()' 2>/dev/null || true)
  if [ "$recovery_state" = f ]; then
    postgres_ready=true
    break
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$validation_postgres")" != true ]; then break; fi
  sleep 1
done
if [ "$postgres_ready" != true ]; then
  docker logs --tail 120 "$validation_postgres" >&2
  echo "PITR 候选未在 180 秒内启动" >&2
  exit 1
fi
checksum_state=$(docker exec --user postgres "$validation_postgres" psql --no-psqlrc \
  --username postgres --dbname postgres --tuples-only --no-align --command 'SHOW data_checksums')
[ "$checksum_state" = on ] || { echo "PITR 候选未保留 data checksums" >&2; exit 1; }
unfinished_migrations=$(docker exec --user postgres "$validation_postgres" psql --no-psqlrc \
  --username postgres --dbname wenyousite --tuples-only --no-align --command \
  'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL')
[ "$unfinished_migrations" = 0 ] || { echo "恢复候选包含未完成 Prisma migration" >&2; exit 1; }
docker exec --user postgres "$validation_postgres" pg_amcheck --all --no-dependent-indexes
docker stop --time 60 "$validation_postgres" >/dev/null
docker rm "$validation_postgres" >/dev/null
validation_postgres=""

acquire_restic_lock
snapshot_json=$(restic snapshots --tag redis --json)
target_nanoseconds=$((target_epoch * 1000000000))
selected_nanoseconds=-1
redis_snapshot_id=""
redis_snapshot_time=""
redis_snapshot_path=""
while IFS=$'\t' read -r candidate_snapshot_id candidate_snapshot_time candidate_snapshot_path; do
  candidate_nanoseconds=$(date -u -d "$candidate_snapshot_time" +%s%N 2>/dev/null) || {
    echo "restic snapshot 时间非法: $candidate_snapshot_time" >&2
    exit 1
  }
  if (( candidate_nanoseconds <= target_nanoseconds && candidate_nanoseconds > selected_nanoseconds )); then
    selected_nanoseconds=$candidate_nanoseconds
    redis_snapshot_id=$candidate_snapshot_id
    redis_snapshot_time=$candidate_snapshot_time
    redis_snapshot_path=$candidate_snapshot_path
  fi
done < <(jq -r '.[] as $snapshot | $snapshot.paths[]? | select(endswith(".rdb")) | [$snapshot.id, $snapshot.time, .] | @tsv' <<<"$snapshot_json")
[ -n "$redis_snapshot_id" ] || { echo "找不到不晚于 $target_utc 的 Redis 异地快照" >&2; exit 1; }
[[ "$redis_snapshot_id" =~ ^[0-9a-f]+$ ]] || { echo "restic snapshot ID 非法" >&2; exit 1; }
redis_basename=$(basename -- "$redis_snapshot_path")
[[ "$redis_basename" =~ ^wenyousite_redis_[0-9]{8}T[0-9]{6}Z\.rdb$ ]] || {
  echo "Redis 快照路径不符合受控命名" >&2
  exit 1
}
restic dump "$redis_snapshot_id" "$redis_snapshot_path" >"$work_dir/$redis_basename"
restic dump "$redis_snapshot_id" "$redis_snapshot_path.sha256" >"$work_dir/$redis_basename.sha256"
flock -u 9
(cd -- "$work_dir" && sha256sum --check --status "$redis_basename.sha256")
docker run --rm --volume "$work_dir:/restore:ro" --entrypoint redis-check-rdb \
  "$REDIS_IMAGE" "/restore/$redis_basename" >/dev/null

docker run --rm --user root --volume "$redis_volume:/data" --volume "$work_dir:/restore:ro" \
  "$REDIS_IMAGE" sh -eu -c '
    cp "/restore/$1" /data/dump.rdb
    chown -R redis:redis /data
  ' restore-copy "$redis_basename"
validation_redis="wenyousite-restore-redis-$candidate_id"
docker run --detach --name "$validation_redis" --network none \
  --user redis \
  --group-add "$WENYOUSITE_SECRETS_GID" \
  --env REDIS_OPS_USERNAME=wenyousite_ops \
  --volume "$redis_volume:/data" \
  --volume "$SECRETS_DIR/redis-users.acl:/run/secrets/wenyousite/redis-users.acl:ro" \
  --volume "$SECRETS_DIR/redis-ops-password:/run/secrets/wenyousite/redis-ops-password:ro" \
  "$REDIS_IMAGE" redis-server \
  --aclfile /run/secrets/wenyousite/redis-users.acl \
  --appendonly no --appendfsync everysec --maxmemory-policy noeviction >/dev/null

redis_ready=false
for _attempt in $(seq 1 60); do
  if redis_cli "$validation_redis" PING 2>/dev/null | grep -qx PONG; then redis_ready=true; break; fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$validation_redis")" != true ]; then break; fi
  sleep 1
done
[ "$redis_ready" = true ] || { docker logs --tail 120 "$validation_redis" >&2; echo "Redis 恢复候选未启动" >&2; exit 1; }

purge_lua='local cursor="0" local deleted=0 repeat local result=redis.call("SCAN",cursor,"COUNT",1000) cursor=result[1] for _,key in ipairs(result[2]) do if string.sub(key,1,5)~="bull:" then redis.call("UNLINK",key) deleted=deleted+1 end end until cursor=="0" return deleted'
for _pass in $(seq 1 10); do
  deleted=$(redis_cli "$validation_redis" EVAL "$purge_lua" 0)
  [ "$deleted" = 0 ] && break
done
non_bull_count=$(redis_cli "$validation_redis" EVAL \
  'local c="0" local n=0 repeat local r=redis.call("SCAN",c,"COUNT",1000) c=r[1] for _,k in ipairs(r[2]) do if string.sub(k,1,5)~="bull:" then n=n+1 end end until c=="0" return n' 0)
[ "$non_bull_count" = 0 ] || { echo "Redis 派生键清理不完整" >&2; exit 1; }
[ "$(redis_cli "$validation_redis" SAVE)" = OK ] || { echo "Redis 恢复候选 SAVE 失败" >&2; exit 1; }
docker exec "$validation_redis" redis-check-rdb /data/dump.rdb >/dev/null

# Redis prefers AOF whenever appendonly=yes. Load and clean the RDB first,
# then create AOF online and prove the resulting log survives a restart.
redis_sentinel="wenyousite:restore:aof:$candidate_id"
[ "$(redis_cli "$validation_redis" SET "$redis_sentinel" "$candidate_id")" = OK ]
[ "$(redis_cli "$validation_redis" CONFIG SET appendfsync everysec)" = OK ]
[ "$(redis_cli "$validation_redis" CONFIG SET appendonly yes)" = OK ]
aof_ready=false
for _attempt in $(seq 1 120); do
  persistence=$(redis_cli "$validation_redis" INFO persistence | tr -d '\r')
  if grep -q '^aof_enabled:1$' <<<"$persistence" &&
    grep -q '^aof_rewrite_in_progress:0$' <<<"$persistence" &&
    grep -q '^aof_rewrite_scheduled:0$' <<<"$persistence" &&
    grep -q '^aof_last_bgrewrite_status:ok$' <<<"$persistence" &&
    grep -q '^aof_last_write_status:ok$' <<<"$persistence"; then
    aof_ready=true
    break
  fi
  sleep 1
done
[ "$aof_ready" = true ] || { echo "Redis 恢复候选 AOF 未成功生成" >&2; exit 1; }
docker stop --time 60 "$validation_redis" >/dev/null
docker rm "$validation_redis" >/dev/null
validation_redis=""

validation_redis="wenyousite-restore-redis-$candidate_id"
docker run --detach --name "$validation_redis" --network none \
  --user redis \
  --group-add "$WENYOUSITE_SECRETS_GID" \
  --env REDIS_OPS_USERNAME=wenyousite_ops \
  --volume "$redis_volume:/data" \
  --volume "$SECRETS_DIR/redis-users.acl:/run/secrets/wenyousite/redis-users.acl:ro" \
  --volume "$SECRETS_DIR/redis-ops-password:/run/secrets/wenyousite/redis-ops-password:ro" \
  "$REDIS_IMAGE" redis-server \
  --aclfile /run/secrets/wenyousite/redis-users.acl \
  --appendonly yes --appendfsync everysec --maxmemory-policy noeviction >/dev/null
redis_ready=false
for _attempt in $(seq 1 60); do
  if redis_cli "$validation_redis" PING 2>/dev/null | grep -qx PONG; then redis_ready=true; break; fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$validation_redis")" != true ]; then break; fi
  sleep 1
done
[ "$redis_ready" = true ] || { docker logs --tail 120 "$validation_redis" >&2; echo "Redis AOF 候选重启失败" >&2; exit 1; }
[ "$(redis_cli "$validation_redis" GET "$redis_sentinel")" = "$candidate_id" ] || {
  echo "Redis AOF 重启后恢复哨兵缺失" >&2
  exit 1
}
[ "$(redis_cli "$validation_redis" DEL "$redis_sentinel")" = 1 ]
non_bull_count=$(redis_cli "$validation_redis" EVAL \
  'local c="0" local n=0 repeat local r=redis.call("SCAN",c,"COUNT",1000) c=r[1] for _,k in ipairs(r[2]) do if string.sub(k,1,5)~="bull:" then n=n+1 end end until c=="0" return n' 0)
[ "$non_bull_count" = 0 ] || { echo "Redis AOF 重启后出现派生键" >&2; exit 1; }
[ "$(redis_cli "$validation_redis" SAVE)" = OK ]
docker stop --time 60 "$validation_redis" >/dev/null
docker rm "$validation_redis" >/dev/null
validation_redis=""
docker run --rm --volume "$redis_volume:/data:ro" "$REDIS_IMAGE" sh -eu -c '
  redis-check-rdb /data/dump.rdb >/dev/null
  redis-check-aof /data/appendonlydir/appendonly.aof.manifest >/dev/null
'

manifest_temp=$(mktemp "$CANDIDATE_DIR/.manifest.$candidate_id.XXXXXX")
{
  printf 'candidate_id=%s\n' "$candidate_id"
  printf 'status=validated\n'
  printf 'target_utc=%s\n' "$target_utc"
  printf 'postgres_target_type=%s\n' "$pgbackrest_target_type"
  printf 'postgres_target=%s\n' "$pgbackrest_target"
  printf 'postgres_volume=%s\n' "$pg_volume"
  printf 'redis_volume=%s\n' "$redis_volume"
  printf 'redis_snapshot_id=%s\n' "$redis_snapshot_id"
  printf 'redis_snapshot_time=%s\n' "$redis_snapshot_time"
  printf 'prepared_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} >"$manifest_temp"
chmod 0600 "$manifest_temp"
mv -- "$manifest_temp" "$manifest"

find "$work_dir" -depth -delete
trap - EXIT INT TERM
echo "恢复候选已在新卷完成离线校验；当前运行卷未改变。"
printf 'TARGET_UTC=%s\n' "$target_utc"
printf 'POSTGRES_VOLUME=%s\n' "$pg_volume"
printf 'REDIS_VOLUME=%s\n' "$redis_volume"
