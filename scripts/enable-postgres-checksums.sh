#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BACKEND_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE="$BACKEND_DIR/docker-compose.yml"
CONFIG_ROOT=${WENYOUSITE_CONFIG_ROOT:-/etc/wenyousite}
COMPOSE_ENV=${WENYOUSITE_COMPOSE_ENV:-$CONFIG_ROOT/compose.env}

[ "$#" -eq 1 ] && [ "$1" = --apply ] || {
  echo "用法: $0 --apply" >&2
  exit 2
}
[ "$(id -u)" -eq 0 ] || { echo "必须以 root 运行" >&2; exit 1; }
for unit in wenyousite-backend.service wenyousite-image-worker.service; do
  if systemctl is-active --quiet "$unit"; then
    echo "$unit 仍在运行；离线校验和切换前必须停止写入" >&2
    exit 1
  fi
done

set -a
# shellcheck disable=SC1090 -- root-owned file is checked by production preflight.
source "$COMPOSE_ENV"
set +a
: "${POSTGRES_VOLUME:?POSTGRES_VOLUME 未配置}"
[[ "$POSTGRES_VOLUME" =~ ^wenyousite_[a-z0-9_]+$ ]] || { echo "拒绝未知 PostgreSQL 卷名" >&2; exit 1; }
docker volume inspect "$POSTGRES_VOLUME" >/dev/null

POSTGRES_CONTAINER=$(docker compose -f "$COMPOSE_FILE" ps -q postgres)
[ -n "$POSTGRES_CONTAINER" ] || { echo "PostgreSQL 容器不存在" >&2; exit 1; }
checksum_state=$(docker exec --user postgres "$POSTGRES_CONTAINER" psql --no-psqlrc \
  --username postgres --dbname postgres --tuples-only --no-align --command 'SHOW data_checksums')
if [ "$checksum_state" = on ]; then
  echo "PostgreSQL data checksums 已启用"
  exit 0
fi
[ "$checksum_state" = off ] || { echo "无法确认 data_checksums 状态" >&2; exit 1; }

image_id=$(docker compose -f "$COMPOSE_FILE" images -q postgres)
[ -n "$image_id" ] || { echo "找不到已构建的 PostgreSQL 镜像" >&2; exit 1; }
docker compose -f "$COMPOSE_FILE" stop postgres
docker run --rm --user postgres --volume "$POSTGRES_VOLUME:/var/lib/postgresql/data" \
  "$image_id" pg_checksums --enable --pgdata=/var/lib/postgresql/data
docker compose -f "$COMPOSE_FILE" up -d --wait postgres

POSTGRES_CONTAINER=$(docker compose -f "$COMPOSE_FILE" ps -q postgres)
checksum_state=$(docker exec --user postgres "$POSTGRES_CONTAINER" psql --no-psqlrc \
  --username postgres --dbname postgres --tuples-only --no-align --command 'SHOW data_checksums')
[ "$checksum_state" = on ] || { echo "PostgreSQL 重启后 data_checksums 仍未启用" >&2; exit 1; }
echo "PostgreSQL data checksums 已离线启用并验证"
