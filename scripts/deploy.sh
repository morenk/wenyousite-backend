#!/bin/bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BACKEND_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
WORKSPACE_DIR=$(cd -- "$BACKEND_DIR/.." && pwd)
FRONTEND_DIR="$WORKSPACE_DIR/wenyousite-frontend"
COMPOSE_FILE="$BACKEND_DIR/docker-compose.yml"
BACKEND_BUILD_SHA=$(git -C "$BACKEND_DIR" rev-parse HEAD)

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

echo "=== 温油站公网开发环境部署 ==="
echo "1. 执行前后端质量门禁..."
(cd "$BACKEND_DIR" && pnpm check)
(cd "$FRONTEND_DIR" && pnpm check)

echo "2. 确保 PostgreSQL 与 Redis 可用..."
docker compose -f "$COMPOSE_FILE" up -d --wait

echo "3. 备份并迁移数据库..."
(cd "$BACKEND_DIR" && bash scripts/backup.sh && pnpm exec prisma migrate deploy)

echo "4. 通过 systemd 切换后端..."
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
  echo "后端 buildSha 与待部署提交不一致" >&2
  exit 1
fi

echo "5. 通过 systemd 切换前端..."
(cd "$FRONTEND_DIR" && bash scripts/deploy-standalone.sh)

echo "6. 验证公网入口..."
curl --fail --silent --show-error https://wenyou.site/api/v1/health > /dev/null
curl --fail --silent --show-error --head https://wenyou.site > /dev/null
echo "=== 部署完成 ==="
