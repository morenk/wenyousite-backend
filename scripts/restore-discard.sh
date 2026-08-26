#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
CONFIG_ROOT=${WENYOUSITE_CONFIG_ROOT:-/etc/wenyousite}
COMPOSE_ENV=${WENYOUSITE_COMPOSE_ENV:-$CONFIG_ROOT/compose.env}
CANDIDATE_DIR=${WENYOUSITE_RESTORE_CANDIDATE_DIR:-/var/lib/wenyousite/restore-candidates}

[ "$#" -eq 4 ] && [ "$1" = --candidate ] && [ "$3" = --confirm ] && \
  [ "$4" = DELETE_RESTORE_CANDIDATE ] || {
  echo "用法: $0 --candidate CANDIDATE_ID --confirm DELETE_RESTORE_CANDIDATE" >&2
  exit 2
}
candidate_id=$2
[[ "$candidate_id" =~ ^[0-9]{8}t[0-9]{6}z_[0-9a-f]{8}$ ]] || { echo "候选 ID 非法" >&2; exit 2; }
[ "$(id -u)" -eq 0 ] || { echo "必须以 root 运行" >&2; exit 1; }
manifest="$CANDIDATE_DIR/$candidate_id.env"
[ -f "$manifest" ] && [ "$(stat -c %u "$manifest")" -eq 0 ] || { echo "候选 manifest 不存在" >&2; exit 1; }
value() { awk -F= -v key="$1" '$1 == key { print substr($0, index($0, "=") + 1); exit }' "$manifest"; }
status=$(value status)
[[ "$status" = preparing || "$status" = validated ]] || { echo "不得删除状态为 $status 的候选" >&2; exit 1; }
pg_volume=$(value postgres_volume)
redis_volume=$(value redis_volume)
[[ "$pg_volume" = "wenyousite_pgdata_restore_$candidate_id" ]] || { echo "PostgreSQL 卷名不一致" >&2; exit 1; }
[[ "$redis_volume" = "wenyousite_redisdata_restore_$candidate_id" ]] || { echo "Redis 卷名不一致" >&2; exit 1; }

active_pg=$(awk -F= '$1 == "POSTGRES_VOLUME" { print $2; exit }' "$COMPOSE_ENV")
active_redis=$(awk -F= '$1 == "REDIS_VOLUME" { print $2; exit }' "$COMPOSE_ENV")
[ "$pg_volume" != "$active_pg" ] && [ "$redis_volume" != "$active_redis" ] || { echo "拒绝删除活动卷" >&2; exit 1; }
for volume in "$pg_volume" "$redis_volume"; do
  [ "$(docker volume inspect -f '{{index .Labels "com.wenyousite.restore-id"}}' "$volume")" = "$candidate_id" ] || {
    echo "卷标签不属于该候选: $volume" >&2
    exit 1
  }
  [ -z "$(docker ps --all --quiet --filter "volume=$volume")" ] || { echo "仍有容器挂载 $volume" >&2; exit 1; }
done

docker volume rm "$pg_volume" "$redis_volume" >/dev/null
work_dir="$CANDIDATE_DIR/.work_$candidate_id"
if [ -d "$work_dir" ]; then
  case "$work_dir" in
    "$CANDIDATE_DIR"/.work_"$candidate_id") find "$work_dir" -depth -delete ;;
    *) echo "拒绝清理非候选工作目录: $work_dir" >&2; exit 1 ;;
  esac
fi
find "$manifest" -maxdepth 0 -type f -delete
echo "已删除未激活的恢复候选、临时恢复文件及两个专用卷（不可恢复）: $candidate_id"
