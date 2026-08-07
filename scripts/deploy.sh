#!/bin/bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BACKEND_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
WORKSPACE_DIR=$(cd -- "$BACKEND_DIR/.." && pwd)
FRONTEND_DIR="$WORKSPACE_DIR/wenyousite-frontend"
COMPOSE_FILE="$BACKEND_DIR/docker-compose.yml"
RUNTIME_DIR=/tmp/opencode

mkdir -p "$RUNTIME_DIR"

wait_for_http() {
  local url=$1
  local service_name=$2
  local log_file=$3
  local attempt

  for attempt in $(seq 1 30); do
    if curl --fail --silent --max-time 5 "$url" > /dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "$service_name 未能在 30 秒内通过健康检查: $url" >&2
  if [ -f "$log_file" ]; then
    tail -n 80 "$log_file" >&2
  fi
  return 1
}

stop_process() {
  local pid=$1
  local service_name=$2
  local attempt

  if [ -z "$pid" ]; then
    return 0
  fi

  kill "$pid"
  for attempt in $(seq 1 50); do
    if ! kill -0 "$pid" 2> /dev/null; then
      return 0
    fi
    sleep 0.1
  done

  echo "$service_name 旧进程未能在 5 秒内退出（PID: $pid）" >&2
  return 1
}

echo "=== 温油站公网开发环境部署 ==="
echo "1. 执行前后端质量门禁..."
(cd "$BACKEND_DIR" && pnpm check)
(cd "$FRONTEND_DIR" && pnpm check)

echo "2. 确保 PostgreSQL 与 Redis 可用..."
docker compose -f "$COMPOSE_FILE" up -d --wait

echo "3. 备份并迁移数据库..."
(cd "$BACKEND_DIR" && bash scripts/backup.sh && pnpm exec prisma migrate deploy)

echo "4. 切换后端宿主机进程..."
BACKEND_PID=$(ss -tlnp | awk '/:3000 / && /pid=/ { match($0, /pid=([0-9]+)/, a); print a[1]; exit }')
stop_process "$BACKEND_PID" "后端"
(cd "$BACKEND_DIR" && setsid nohup env NODE_ENV=production node dist/main </dev/null \
  > "$RUNTIME_DIR/wenyousite-backend.log" 2>&1 &)
wait_for_http \
  http://127.0.0.1:3000/api/v1/health \
  "后端" \
  "$RUNTIME_DIR/wenyousite-backend.log"

echo "5. 切换前端宿主机进程..."
(cd "$FRONTEND_DIR" && cp -a .next/static .next/standalone/.next/ && cp -a public .next/standalone/)
FRONTEND_PID=$(ss -tlnp | awk '/:3001 / && /pid=/ { match($0, /pid=([0-9]+)/, a); print a[1]; exit }')
stop_process "$FRONTEND_PID" "前端"
(cd "$FRONTEND_DIR" && setsid nohup env PORT=3001 node .next/standalone/server.js </dev/null \
  > "$RUNTIME_DIR/wenyousite-frontend.log" 2>&1 &)
wait_for_http \
  http://127.0.0.1:3001 \
  "前端" \
  "$RUNTIME_DIR/wenyousite-frontend.log"

echo "6. 验证公网入口..."
curl --fail --silent --show-error https://wenyou.site/api/v1/health > /dev/null
curl --fail --silent --show-error --head https://wenyou.site > /dev/null
echo "=== 部署完成 ==="
