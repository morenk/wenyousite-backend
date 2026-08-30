#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BACKEND_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
WORKSPACE_DIR=$(cd -- "$BACKEND_DIR/.." && pwd)
FRONTEND_DIR="$WORKSPACE_DIR/wenyousite-frontend"
COMPOSE_FILE="$BACKEND_DIR/docker-compose.yml"
CONFIG_ROOT=${WENYOUSITE_CONFIG_ROOT:-/etc/wenyousite}
COMPOSE_ENV=${WENYOUSITE_COMPOSE_ENV:-$CONFIG_ROOT/compose.env}
DEPLOY_LOCK_FILE=${WENYOU_DEPLOY_LOCK_FILE:-/var/lib/wenyousite/deploy.lock}
DEPLOY_FRONTEND=true
IMAGE_WORKER_UNIT=wenyousite-image-worker.service

usage() {
  echo "用法: $0 [--all|--backend-only]" >&2
}
if [ "$#" -gt 1 ]; then usage; exit 2; fi
if [ "$#" -eq 1 ]; then
  case "$1" in
    --all) ;;
    --backend-only) DEPLOY_FRONTEND=false ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
fi
[ "$(id -u)" -eq 0 ] || { echo "公网部署必须以 root 运行" >&2; exit 1; }

for command_name in curl docker flock git install jq node pnpm restic systemctl; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "缺少部署命令: $command_name" >&2; exit 1; }
done
if [ "$DEPLOY_FRONTEND" = true ] && [ ! -d "$FRONTEND_DIR" ]; then
  echo "前端仓库不存在: $FRONTEND_DIR" >&2
  exit 1
fi

install -d -m 0755 "$(dirname -- "$DEPLOY_LOCK_FILE")"
exec 8>"$DEPLOY_LOCK_FILE"
flock -n 8 || { echo "另一个全栈部署正在进行" >&2; exit 1; }

wait_for_http() {
  local url=$1
  local service_name=$2
  for _attempt in $(seq 1 60); do
    if curl --fail --silent --max-time 5 "$url" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "$service_name 未在 60 秒内通过健康检查: $url" >&2
  return 1
}
wait_for_systemd_active() {
  local unit=$1
  local service_name=$2
  for _attempt in $(seq 1 30); do
    if systemctl is-active --quiet "$unit"; then return 0; fi
    sleep 1
  done
  echo "$service_name 未在 30 秒内保持 active: $unit" >&2
  systemctl show "$unit" -p ActiveState -p SubState -p Result -p ExecMainStatus -p NRestarts --no-pager >&2 || true
  return 1
}
assert_same_sha() {
  local label=$1 expected=$2 actual=$3
  [ "$expected" = "$actual" ] || { echo "$label 在门禁期间变化: $expected -> $actual" >&2; exit 1; }
}

echo "=== 温油站公网开发环境部署 ==="
echo "1. 验证不可变部署源与主机安全配置..."
BACKEND_BUILD_SHA=$(bash "$SCRIPT_DIR/assert-releasable-repo.sh" "$BACKEND_DIR" dev)
if [ "$DEPLOY_FRONTEND" = true ]; then
  FRONTEND_BUILD_SHA=$(bash "$FRONTEND_DIR/scripts/assert-releasable-repo.sh" "$FRONTEND_DIR" dev)
fi
bash "$SCRIPT_DIR/validate-production-security.sh"
[ -f /var/lib/wenyousite/backup-state/security-activated ] || {
  echo "数据安全尚未完成首次激活；先运行 activate-data-security.sh" >&2
  exit 1
}
set -a
# shellcheck disable=SC1090 -- validated root-owned file.
source "$COMPOSE_ENV"
set +a

echo "2. 执行质量与生产依赖安全门禁..."
(cd "$BACKEND_DIR" && pnpm security:audit && pnpm check)
if [ "$DEPLOY_FRONTEND" = true ]; then (cd "$FRONTEND_DIR" && pnpm check); fi

echo "3. 在有状态操作前重新验证提交..."
current_backend_sha=$(bash "$SCRIPT_DIR/assert-releasable-repo.sh" "$BACKEND_DIR" dev)
assert_same_sha "后端提交" "$BACKEND_BUILD_SHA" "$current_backend_sha"
if [ "$DEPLOY_FRONTEND" = true ]; then
  current_frontend_sha=$(bash "$FRONTEND_DIR/scripts/assert-releasable-repo.sh" "$FRONTEND_DIR" dev)
  assert_same_sha "前端提交" "$FRONTEND_BUILD_SHA" "$current_frontend_sha"
fi

echo "4. 验证基础设施并生成迁移前异地备份..."
install -m 0644 "$BACKEND_DIR/ops/99-wenyousite-redis.conf" /etc/sysctl.d/99-wenyousite-redis.conf
sysctl -q -p /etc/sysctl.d/99-wenyousite-redis.conf
[ "$(sysctl -n vm.overcommit_memory)" = 1 ] || { echo "vm.overcommit_memory 未生效" >&2; exit 1; }
for service in postgres redis; do
  container=$(docker compose -f "$COMPOSE_FILE" ps -q "$service")
  [ -n "$container" ] && [ "$(docker inspect -f '{{.State.Running}}' "$container")" = true ] &&
    [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container")" = healthy ] || {
    echo "$service 容器不健康，拒绝部署" >&2
    exit 1
  }
done
bash "$SCRIPT_DIR/backup-postgres-physical.sh" diff
WENYOUSITE_OFFSITE_REQUIRED=true bash "$SCRIPT_DIR/backup.sh"
WENYOUSITE_OFFSITE_REQUIRED=true bash "$SCRIPT_DIR/backup-redis.sh"

current_backend_sha=$(bash "$SCRIPT_DIR/assert-releasable-repo.sh" "$BACKEND_DIR" dev)
assert_same_sha "后端提交" "$BACKEND_BUILD_SHA" "$current_backend_sha"

echo "5. 应用固定镜像与数据平面配置..."
docker compose -f "$COMPOSE_FILE" up -d --build --wait postgres redis
bash "$SCRIPT_DIR/validate-running-data-security.sh"

echo "6. 组装不可变非 root release 并安装 systemd 单元..."
bash "$SCRIPT_DIR/assemble-backend-release.sh" --sha "$BACKEND_BUILD_SHA"
current_backend_sha=$(bash "$SCRIPT_DIR/assert-releasable-repo.sh" "$BACKEND_DIR" dev)
assert_same_sha "后端提交" "$BACKEND_BUILD_SHA" "$current_backend_sha"
install -m 0755 "$SCRIPT_DIR/wenyousite-backend-start.sh" /usr/local/sbin/wenyousite-backend-start
install -m 0755 "$SCRIPT_DIR/wenyousite-image-worker-start.sh" /usr/local/sbin/wenyousite-image-worker-start
install -m 0755 "$SCRIPT_DIR/promote-android-release.sh" /usr/local/sbin/wenyousite-promote-android
for unit_file in \
  wenyousite-backend.service \
  wenyousite-image-worker.service \
  wenyousite-database-migrate.service \
  'wenyousite-backup-alert@.service' \
  wenyousite-backup-health.service \
  wenyousite-backup-health.timer \
  wenyousite-postgres-logical-backup.service \
  wenyousite-postgres-logical-backup.timer \
  wenyousite-postgres-physical-backup.service \
  wenyousite-postgres-physical-backup.timer \
  wenyousite-redis-backup.service \
  wenyousite-redis-backup.timer \
  wenyousite-restic-maintenance.service \
  wenyousite-restic-maintenance.timer \
  wenyousite-restore-drill.service \
  wenyousite-restore-drill.timer; do
  install -m 0644 "$BACKEND_DIR/ops/$unit_file" "/etc/systemd/system/$unit_file"
done
systemctl daemon-reload

echo "7. 停止写入、执行 owner 迁移并切换应用..."
systemctl stop wenyousite-backend.service || true
systemctl stop wenyousite-image-worker.service || true
systemctl start wenyousite-database-migrate.service
systemctl enable wenyousite-backend.service wenyousite-image-worker.service >/dev/null
if ! systemctl restart "$IMAGE_WORKER_UNIT"; then
  echo "图片 Worker 重启失败，拒绝继续启动后端" >&2
  systemctl show "$IMAGE_WORKER_UNIT" -p ActiveState -p SubState -p Result -p ExecMainStatus -p NRestarts --no-pager >&2 || true
  systemctl stop wenyousite-backend.service "$IMAGE_WORKER_UNIT" || true
  exit 1
fi
if ! wait_for_systemd_active "$IMAGE_WORKER_UNIT" "图片 Worker"; then
  systemctl stop wenyousite-backend.service "$IMAGE_WORKER_UNIT" || true
  exit 1
fi
if ! systemctl restart wenyousite-backend.service; then
  echo "后端重启失败，停止图片 Worker" >&2
  systemctl stop wenyousite-backend.service "$IMAGE_WORKER_UNIT" || true
  exit 1
fi
if ! wait_for_http http://127.0.0.1:3000/api/v1/health "后端"; then
  systemctl stop wenyousite-backend.service "$IMAGE_WORKER_UNIT"
  journalctl -u wenyousite-backend.service --no-pager -n 120 >&2
  exit 1
fi
DEPLOYED_BUILD_SHA=$(curl --fail --silent --show-error http://127.0.0.1:3000/api/v1/meta | \
  node -e 'let input=""; process.stdin.on("data", c => input += c).on("end", () => process.stdout.write(JSON.parse(input).data.buildSha ?? ""));')
[ "$DEPLOYED_BUILD_SHA" = "$BACKEND_BUILD_SHA" ] || {
  systemctl stop wenyousite-backend.service "$IMAGE_WORKER_UNIT"
  echo "后端 buildSha 不一致: $DEPLOYED_BUILD_SHA != $BACKEND_BUILD_SHA" >&2
  exit 1
}

for timer in \
  wenyousite-backup-health.timer \
  wenyousite-postgres-logical-backup.timer \
  wenyousite-postgres-physical-backup.timer \
  wenyousite-redis-backup.timer \
  wenyousite-restic-maintenance.timer \
  wenyousite-restore-drill.timer; do
  systemctl enable --now "$timer" >/dev/null
done

if [ "$DEPLOY_FRONTEND" = true ]; then
  echo "8. 切换前端不可变 release..."
  (cd "$FRONTEND_DIR" && FRONTEND_EXPECTED_SHA="$FRONTEND_BUILD_SHA" bash scripts/deploy-standalone.sh)
fi

echo "9. 验证公网入口和数据安全状态..."
curl --fail --silent --show-error https://wenyou.site/api/v1/health >/dev/null
if [ "$DEPLOY_FRONTEND" = true ]; then curl --fail --silent --show-error --head https://wenyou.site >/dev/null; fi
bash "$SCRIPT_DIR/validate-running-data-security.sh" --require-image-worker

echo "=== 部署完成 ==="
echo "backendGitSha: $BACKEND_BUILD_SHA"
if [ "$DEPLOY_FRONTEND" = true ]; then echo "frontendGitSha: $FRONTEND_BUILD_SHA"; fi
