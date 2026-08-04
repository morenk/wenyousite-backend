#!/bin/bash
set -euo pipefail

echo "=== 温油站部署 ==="

COMPOSE_FILE="../docker-compose.yml"
ENV_FILE=".env.prod"

if [ ! -f "$ENV_FILE" ]; then
  echo "创建 $ENV_FILE（请先编辑填入生产配置）"
  cp .env.example "$ENV_FILE"
  echo "请编辑 .env.prod 后重新运行"
  exit 1
fi

echo "1. 检查当前已检出的前后端版本..."
pnpm check
(cd ../wenyousite-frontend && pnpm check)

echo "2. 确保数据库和 Redis 可用..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres redis

echo "3. 备份数据库..."
bash scripts/backup.sh "$ENV_FILE"

echo "4. 构建待发布镜像..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build api web

echo "5. 使用新镜像执行向后兼容迁移..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm api npx prisma migrate deploy

echo "6. 切换应用服务..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d api web caddy

echo "7. 验证本机健康状态..."
curl --fail --silent --show-error --retry 10 --retry-delay 2 http://127.0.0.1:3000/api/v1/health > /dev/null
curl --fail --silent --show-error --retry 10 --retry-delay 2 http://127.0.0.1:3001 > /dev/null

echo "=== 部署完成；请继续验证本次改动的关键用户路径并观察日志 ==="
