#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
DEPLOY_SCRIPT="$SCRIPT_DIR/deploy.sh"

grep -Fq 'wait_for_systemd_active()' "$DEPLOY_SCRIPT" || {
  echo "部署脚本缺少图片 Worker active readiness 检查" >&2
  exit 1
}
grep -Fq 'if ! systemctl restart "$IMAGE_WORKER_UNIT"; then' "$DEPLOY_SCRIPT" || {
  echo "部署脚本未处理图片 Worker 重启失败" >&2
  exit 1
}
grep -Fq 'if ! wait_for_systemd_active "$IMAGE_WORKER_UNIT" "图片 Worker"; then' "$DEPLOY_SCRIPT" || {
  echo "部署脚本未等待图片 Worker 稳定运行" >&2
  exit 1
}
grep -Fq 'systemctl stop wenyousite-backend.service "$IMAGE_WORKER_UNIT"' "$DEPLOY_SCRIPT" || {
  echo "图片 Worker 失败时部署脚本未停止应用服务" >&2
  exit 1
}
grep -Fq 'validate-running-data-security.sh" --require-image-worker' "$DEPLOY_SCRIPT" || {
  echo "部署最终验证未要求图片 Worker 运行" >&2
  exit 1
}

worker_restart_line=$(grep -n 'systemctl restart "$IMAGE_WORKER_UNIT"' "$DEPLOY_SCRIPT" | head -n 1 | cut -d: -f1)
worker_ready_line=$(grep -n 'wait_for_systemd_active "$IMAGE_WORKER_UNIT"' "$DEPLOY_SCRIPT" | head -n 1 | cut -d: -f1)
backend_restart_line=$(grep -n 'systemctl restart wenyousite-backend.service' "$DEPLOY_SCRIPT" | head -n 1 | cut -d: -f1)
[[ -n "$worker_restart_line" && -n "$worker_ready_line" && -n "$backend_restart_line" ]] &&
  (( worker_restart_line < worker_ready_line && worker_ready_line < backend_restart_line )) || {
  echo "部署顺序必须是 Worker 重启 → readiness → 后端重启" >&2
  exit 1
}

bash -n "$DEPLOY_SCRIPT"
echo "部署 Worker readiness 测试通过"
