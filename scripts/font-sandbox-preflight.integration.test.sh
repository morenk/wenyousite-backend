#!/usr/bin/env bash
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "同 unit 沙箱回归须由管理身份运行" >&2; exit 1; }
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
UNIT_FILE="$SCRIPT_DIR/../ops/wenyousite-font-worker.service"
TEST_ROOT=$(mktemp -d /var/lib/wenyousite/font-unit-regression-XXXXXX)
trap 'rm -rf --one-file-system -- "$TEST_ROOT"' EXIT

# 先验证真实候选和依赖均可运行；故障样本必须到达探针，不以缺文件等错误冒充回归。
node "$SCRIPT_DIR/font-sandbox-preflight.cjs"
sed 's/ AF_NETLINK$//' "$UNIT_FILE" >"$TEST_ROOT/missing-netlink.service"
sed -e 's/^ProtectKernelTunables=false$/ProtectKernelTunables=true/' \
  -e 's/^ProtectKernelLogs=false$/ProtectKernelLogs=true/' \
  "$UNIT_FILE" >"$TEST_ROOT/masked-proc.service"
for failure in missing-netlink masked-proc; do
  if node "$SCRIPT_DIR/font-sandbox-preflight.cjs" --unit "$TEST_ROOT/$failure.service" >"$TEST_ROOT/$failure.log" 2>&1; then
    echo "历史沙箱故障未被预检拦截: $failure" >&2
    exit 1
  fi
  grep -Fxq 'FONT_SANDBOX_PREFLIGHT_FAILED:boundaries' "$TEST_ROOT/$failure.log" || {
    echo "故障样本未到达真实沙箱探针: $failure" >&2
    exit 1
  }
done
echo "字体同 unit 预检回归通过：候选成功，缺失 NETLINK 与 proc 屏蔽均拒绝"
