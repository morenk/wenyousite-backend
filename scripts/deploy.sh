#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BACKEND_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
WORKSPACE_DIR=$(cd -- "$BACKEND_DIR/.." && pwd)
FRONTEND_DIR="$WORKSPACE_DIR/wenyousite-frontend"
COMPOSE_FILE="$BACKEND_DIR/docker-compose.yml"
DEPLOY_LOCK_FILE=${WENYOU_DEPLOY_LOCK_FILE:-/var/lib/wenyousite/deploy.lock}
BACKEND_REVISION_FILE=${WENYOU_BACKEND_REVISION_FILE:-/var/lib/wenyousite/backend/current-revision}
DEPLOY_FRONTEND=true
revision_temp=""

usage() {
  echo "用法: $0 [--all|--backend-only]" >&2
}

if [ "$#" -gt 1 ]; then
  usage
  exit 2
fi
if [ "$#" -eq 1 ]; then
  case "$1" in
    --all) ;;
    --backend-only) DEPLOY_FRONTEND=false ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 2
      ;;
  esac
fi

cleanup() {
  if [ -n "$revision_temp" ] && [ -f "$revision_temp" ]; then
    rm -f -- "$revision_temp"
  fi
}
trap cleanup EXIT

wait_for_http() {
  local url=$1
  local service_name=$2
  local log_file=$3
  local attempt

  for attempt in $(seq 1 30); do
    if curl --fail --silent --max-time 5 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "$service_name 未能在 30 秒内通过健康检查: $url" >&2
  if [ -n "$log_file" ] && [ -f "$log_file" ]; then
    tail -n 80 "$log_file" >&2
  fi
  return 1
}

assert_same_sha() {
  local label=$1
  local expected=$2
  local actual=$3

  if [ "$expected" != "$actual" ]; then
    echo "$label 在质量门禁期间发生变化: $expected -> $actual" >&2
    exit 1
  fi
}

for command_name in curl docker flock git install node pnpm systemctl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "缺少部署命令: $command_name" >&2
    exit 1
  fi
done
if [ "$DEPLOY_FRONTEND" = true ] && [ ! -d "$FRONTEND_DIR" ]; then
  echo "前端仓库不存在: $FRONTEND_DIR" >&2
  exit 1
fi

install -d -m 0755 "$(dirname -- "$DEPLOY_LOCK_FILE")"
exec 8>"$DEPLOY_LOCK_FILE"
if ! flock -n 8; then
  echo "另一个全栈部署正在进行" >&2
  exit 1
fi

echo "=== 温油站公网开发环境部署 ==="
echo "1. 验证部署源..."
BACKEND_BUILD_SHA=$(bash "$SCRIPT_DIR/assert-releasable-repo.sh" "$BACKEND_DIR" dev)
if [ "$DEPLOY_FRONTEND" = true ]; then
  FRONTEND_BUILD_SHA=$(bash "$FRONTEND_DIR/scripts/assert-releasable-repo.sh" "$FRONTEND_DIR" dev)
fi

echo "2. 执行质量与生产依赖安全门禁..."
(cd "$BACKEND_DIR" && pnpm security:audit && pnpm check)
if [ "$DEPLOY_FRONTEND" = true ]; then
  (cd "$FRONTEND_DIR" && pnpm check)
fi

echo "3. 在有状态操作前重新验证部署源..."
current_backend_sha=$(bash "$SCRIPT_DIR/assert-releasable-repo.sh" "$BACKEND_DIR" dev)
assert_same_sha "后端提交" "$BACKEND_BUILD_SHA" "$current_backend_sha"
if [ "$DEPLOY_FRONTEND" = true ]; then
  current_frontend_sha=$(bash "$FRONTEND_DIR/scripts/assert-releasable-repo.sh" "$FRONTEND_DIR" dev)
  assert_same_sha "前端提交" "$FRONTEND_BUILD_SHA" "$current_frontend_sha"
fi

echo "4. 在基础设施变更前检查并备份现有数据..."
POSTGRES_CONTAINER=$(docker compose -f "$COMPOSE_FILE" ps -q postgres)
REDIS_CONTAINER=$(docker compose -f "$COMPOSE_FILE" ps -q redis)
POSTGRES_READY=false
REDIS_READY=false
if [ -n "$POSTGRES_CONTAINER" ]; then
  if [ "$(docker inspect -f '{{.State.Running}}' "$POSTGRES_CONTAINER")" != "true" ] ||
    [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$POSTGRES_CONTAINER")" != "healthy" ]; then
    echo "现有 PostgreSQL 容器不健康，拒绝在备份前变更基础设施" >&2
    exit 1
  fi
  POSTGRES_READY=true
fi
if [ -n "$REDIS_CONTAINER" ]; then
  if [ "$(docker inspect -f '{{.State.Running}}' "$REDIS_CONTAINER")" != "true" ] ||
    [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$REDIS_CONTAINER")" != "healthy" ]; then
    echo "现有 Redis 容器不健康，拒绝在备份前变更基础设施" >&2
    exit 1
  fi
  REDIS_READY=true
fi

REDIS_AOF_MIGRATION=false
REDIS_SENTINEL_KEY="wenyousite:deploy:aof:$BACKEND_BUILD_SHA"
if [ "$REDIS_READY" = true ]; then
  REDIS_APPENDONLY=$(docker exec "$REDIS_CONTAINER" redis-cli --raw CONFIG GET appendonly | tail -n 1)
  if [ "$REDIS_APPENDONLY" != "yes" ]; then
    REDIS_AOF_MIGRATION=true
    echo "检测到 Redis 首次切换 AOF，先停止后端写入..."
    systemctl stop wenyousite-backend.service
    NOTIFICATION_WAITING=$(docker exec "$REDIS_CONTAINER" redis-cli --raw LLEN bull:notification:wait)
    NOTIFICATION_ACTIVE=$(docker exec "$REDIS_CONTAINER" redis-cli --raw LLEN bull:notification:active)
    NOTIFICATION_PAUSED=$(docker exec "$REDIS_CONTAINER" redis-cli --raw LLEN bull:notification:paused)
    NOTIFICATION_DELAYED=$(docker exec "$REDIS_CONTAINER" redis-cli --raw ZCARD bull:notification:delayed)
    NOTIFICATION_PRIORITIZED=$(docker exec "$REDIS_CONTAINER" redis-cli --raw ZCARD bull:notification:prioritized)
    NOTIFICATION_WAITING_CHILDREN=$(docker exec "$REDIS_CONTAINER" redis-cli --raw ZCARD bull:notification:waiting-children)
    NOTIFICATION_FAILED=$(docker exec "$REDIS_CONTAINER" redis-cli --raw ZCARD bull:notification:failed)
    NOTIFICATION_UNRESOLVED=$((
      NOTIFICATION_WAITING + NOTIFICATION_ACTIVE + NOTIFICATION_PAUSED + NOTIFICATION_DELAYED +
        NOTIFICATION_PRIORITIZED + NOTIFICATION_WAITING_CHILDREN + NOTIFICATION_FAILED
    ))
    if (( NOTIFICATION_UNRESOLVED > 0 )); then
      echo "旧通知队列仍有未解决任务，拒绝移除消费者；后端保持停止 waiting=$NOTIFICATION_WAITING active=$NOTIFICATION_ACTIVE paused=$NOTIFICATION_PAUSED delayed=$NOTIFICATION_DELAYED prioritized=$NOTIFICATION_PRIORITIZED waitingChildren=$NOTIFICATION_WAITING_CHILDREN failed=$NOTIFICATION_FAILED" >&2
      exit 1
    fi
    docker exec "$REDIS_CONTAINER" redis-cli --raw SET "$REDIS_SENTINEL_KEY" "$BACKEND_BUILD_SHA" >/dev/null
  fi
fi

if [ "$POSTGRES_READY" = true ]; then
  (cd "$BACKEND_DIR" && bash scripts/backup.sh)
fi
if [ "$REDIS_READY" = true ]; then
  (cd "$BACKEND_DIR" && bash scripts/backup-redis.sh)
fi

echo "5. 应用并验证 PostgreSQL 与 Redis 配置..."
docker compose -f "$COMPOSE_FILE" up -d --wait
REDIS_CONTAINER=$(docker compose -f "$COMPOSE_FILE" ps -q redis)
REDIS_APPENDONLY=$(docker exec "$REDIS_CONTAINER" redis-cli --raw CONFIG GET appendonly | tail -n 1)
REDIS_APPENDFSYNC=$(docker exec "$REDIS_CONTAINER" redis-cli --raw CONFIG GET appendfsync | tail -n 1)
REDIS_PERSISTENCE=$(docker exec "$REDIS_CONTAINER" redis-cli --raw INFO persistence | tr -d '\r')
if [ "$REDIS_APPENDONLY" != "yes" ] || [ "$REDIS_APPENDFSYNC" != "everysec" ] ||
  ! grep -q '^aof_enabled:1$' <<<"$REDIS_PERSISTENCE" ||
  ! grep -q '^aof_last_write_status:ok$' <<<"$REDIS_PERSISTENCE"; then
  echo "Redis AOF 持久化验证失败；后端保持停止，请使用已校验 RDB 备份恢复" >&2
  exit 1
fi
if [ "$REDIS_AOF_MIGRATION" = true ]; then
  REDIS_SENTINEL_VALUE=$(docker exec "$REDIS_CONTAINER" redis-cli --raw GET "$REDIS_SENTINEL_KEY")
  if [ "$REDIS_SENTINEL_VALUE" != "$BACKEND_BUILD_SHA" ]; then
    echo "Redis AOF 切换后未恢复迁移哨兵；后端保持停止" >&2
    exit 1
  fi
  docker exec "$REDIS_CONTAINER" redis-cli --raw DEL "$REDIS_SENTINEL_KEY" >/dev/null
fi

echo "6. 执行数据库迁移..."
(cd "$BACKEND_DIR" && pnpm exec prisma migrate deploy)

echo "7. 记录 revision 并通过 systemd 切换后端..."
revision_dir=$(dirname -- "$BACKEND_REVISION_FILE")
install -d -m 0755 "$revision_dir"
revision_temp=$(mktemp "$revision_dir/.current-revision.XXXXXX")
printf '%s\n' "$BACKEND_BUILD_SHA" >"$revision_temp"
chmod 0644 "$revision_temp"
mv -f -- "$revision_temp" "$BACKEND_REVISION_FILE"
revision_temp=""
install -m 0755 "$SCRIPT_DIR/wenyousite-backend-start.sh" /usr/local/sbin/wenyousite-backend-start
install -m 0644 "$BACKEND_DIR/ops/wenyousite-backend.service" /etc/systemd/system/wenyousite-backend.service
systemctl daemon-reload
systemctl restart wenyousite-backend.service
if ! wait_for_http \
  http://127.0.0.1:3000/api/v1/health \
  "后端" \
  ""; then
  journalctl -u wenyousite-backend.service --no-pager -n 100 >&2
  exit 1
fi
DEPLOYED_BUILD_SHA=$(curl --fail --silent --show-error http://127.0.0.1:3000/api/v1/meta | \
  node -e 'let input=""; process.stdin.on("data", (chunk) => input += chunk).on("end", () => process.stdout.write(JSON.parse(input).data.buildSha ?? ""));')
if [ "$DEPLOYED_BUILD_SHA" != "$BACKEND_BUILD_SHA" ]; then
  echo "后端 buildSha 与待部署提交不一致: $DEPLOYED_BUILD_SHA != $BACKEND_BUILD_SHA" >&2
  exit 1
fi

if [ "$DEPLOY_FRONTEND" = true ]; then
  echo "8. 组装不可变 release 并通过 systemd 切换前端..."
  (cd "$FRONTEND_DIR" && \
    FRONTEND_EXPECTED_SHA="$FRONTEND_BUILD_SHA" bash scripts/deploy-standalone.sh)
fi

echo "9. 验证公网入口..."
curl --fail --silent --show-error https://wenyou.site/api/v1/health >/dev/null
if [ "$DEPLOY_FRONTEND" = true ]; then
  curl --fail --silent --show-error --head https://wenyou.site >/dev/null
fi

echo "=== 部署完成 ==="
echo "backendGitSha: $BACKEND_BUILD_SHA"
if [ "$DEPLOY_FRONTEND" = true ]; then
  echo "frontendGitSha: $FRONTEND_BUILD_SHA"
fi
