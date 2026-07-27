#!/bin/bash
set -e

echo "=== 温油站部署 ==="

# 拉取最新代码
echo "1. 拉取最新代码..."
git pull origin main

# 复制生产环境变量（如果不存在）
if [ ! -f .env.prod ]; then
  echo "2. 创建 .env.prod（请先编辑填入生产配置）"
  cp .env.example .env.prod
  echo "请编辑 .env.prod 后重新运行"
  exit 1
fi

# 构建并启动
echo "3. 构建并启动服务..."
docker compose -f docker-compose.prod.yml up -d --build

# 运行数据库迁移
echo "4. 运行数据库迁移..."
docker compose -f docker-compose.prod.yml exec -T api npx prisma migrate deploy

echo "=== 部署完成 ==="
