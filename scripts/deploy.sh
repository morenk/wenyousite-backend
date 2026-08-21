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

echo "2. 执行质量门禁..."
(cd "$BACKEND_DIR" && pnpm check)
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

echo "4. 确保 PostgreSQL 与 Redis 可用..."
docker compose -f "$COMPOSE_FILE" up -d --wait

echo "5. 备份并迁移数据库..."
(cd "$BACKEND_DIR" && bash scripts/backup.sh && pnpm exec prisma migrate deploy)

echo "6. 记录 revision 并通过 systemd 切换后端..."
revision_dir=$(dirname -- "$BACKEND_REVISION_FILE")
install -d -m 0755 "$revision_dir"
revision_temp=$(mktemp "$revision_dir/.current-revision.XXXXXX")
printf '%s\n' "$BACKEND_BUILD_SHA" >"$revision_temp"
chmod 0644 "$revision_temp"
mv -f -- "$revision_temp" "$BACKEND_REVISION_FILE"
revision_temp=""
install -m 0755 "$SCRIPT_DIR/wenyousite-backend-start.sh" /usr/local/sbin/wenyousite-backend-start
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
  echo "7. 组装不可变 release 并通过 systemd 切换前端..."
  (cd "$FRONTEND_DIR" && \
    FRONTEND_EXPECTED_SHA="$FRONTEND_BUILD_SHA" bash scripts/deploy-standalone.sh)
fi

echo "8. 验证公网入口..."
curl --fail --silent --show-error https://wenyou.site/api/v1/health >/dev/null
if [ "$DEPLOY_FRONTEND" = true ]; then
  curl --fail --silent --show-error --head https://wenyou.site >/dev/null
fi

echo "=== 部署完成 ==="
echo "backendGitSha: $BACKEND_BUILD_SHA"
if [ "$DEPLOY_FRONTEND" = true ]; then
  echo "frontendGitSha: $FRONTEND_BUILD_SHA"
fi
