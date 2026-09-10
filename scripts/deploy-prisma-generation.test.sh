#!/bin/bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/wenyousite-deploy-prisma-test.XXXXXX")
cleanup() {
  case "$TEST_ROOT" in
    "${TMPDIR:-/tmp}"/wenyousite-deploy-prisma-test.*) rm -rf --one-file-system -- "$TEST_ROOT" ;;
    *) echo "拒绝清理非测试目录: $TEST_ROOT" >&2 ;;
  esac
}
trap cleanup EXIT INT TERM
mkdir -p "$TEST_ROOT/backend/scripts" "$TEST_ROOT/bin" "$TEST_ROOT/backup-state"
touch "$TEST_ROOT/backup-state/security-activated" "$TEST_ROOT/compose.env"
# 仅把绝对备份标记映射到隔离目录；执行仓库实际部署控制流，所有外部动作使用命令替身。
sed "s@/var/lib/wenyousite/backup-state/security-activated@$TEST_ROOT/backup-state/security-activated@g" \
  "$SCRIPT_DIR/deploy.sh" >"$TEST_ROOT/backend/scripts/deploy.sh"

cat >"$TEST_ROOT/bin/id" <<'STUB'
#!/bin/bash
printf '0\n'
STUB
cat >"$TEST_ROOT/bin/install" <<'STUB'
#!/bin/bash
exit 0
STUB
cat >"$TEST_ROOT/bin/flock" <<'STUB'
#!/bin/bash
exit 0
STUB
cat >"$TEST_ROOT/bin/bash" <<'STUB'
#!/bin/bash
name=${1##*/}
printf 'script:%s\n' "$name" >>"$TRACE"
case "$name" in
  assert-releasable-repo.sh) printf '0123456789012345678901234567890123456789\n' ;;
  validate-production-security.sh) ;;
  *) exit 97 ;;
esac
STUB
cat >"$TEST_ROOT/bin/pnpm" <<'STUB'
#!/bin/bash
printf 'pnpm:%s\n' "$*" >>"$TRACE"
if [ "$*" = "$FAIL_COMMAND" ]; then exit 42; fi
STUB
cat >"$TEST_ROOT/bin/stop-at-stateful-command" <<'STUB'
#!/bin/bash
printf 'stateful:%s\n' "${0##*/}" >>"$TRACE"
exit 97
STUB
for name in curl docker git jq node restic systemctl sysctl; do
  ln -s stop-at-stateful-command "$TEST_ROOT/bin/$name"
done
chmod +x "$TEST_ROOT/bin/"*
REAL_BASH=$(command -v bash)
for failure in prisma:generate security:audit check none; do
  export TRACE="$TEST_ROOT/$failure.trace" FAIL_COMMAND="$failure"
  : >"$TRACE"
  status=0
  PATH="$TEST_ROOT/bin:$PATH" WENYOUSITE_COMPOSE_ENV="$TEST_ROOT/compose.env" \
    WENYOU_DEPLOY_LOCK_FILE="$TEST_ROOT/deploy.lock" \
    "$REAL_BASH" "$TEST_ROOT/backend/scripts/deploy.sh" --backend-only >"$TEST_ROOT/$failure.log" 2>&1 || status=$?
  case "$failure" in
    prisma:generate) expected=$'pnpm:prisma:generate' ;;
    security:audit) expected=$'pnpm:prisma:generate\npnpm:security:audit' ;;
    check|none) expected=$'pnpm:prisma:generate\npnpm:security:audit\npnpm:check' ;;
  esac
  actual=$(grep '^pnpm:' "$TRACE" || true)
  [ "$actual" = "$expected" ] || { cat "$TRACE" >&2; echo "生成与质量门禁顺序错误: $failure" >&2; exit 1; }
  if [ "$failure" = none ]; then
    [ "$status" -eq 97 ] && grep -q '^stateful:sysctl$' "$TRACE" || {
      cat "$TEST_ROOT/$failure.log" >&2; echo "成功门禁未进入后续部署阶段" >&2; exit 1;
    }
  else
    [ "$status" -eq 42 ] || { cat "$TEST_ROOT/$failure.log" >&2; echo "未传播门禁失败" >&2; exit 1; }
    if grep -Eq '^stateful:|^script:(backup|assemble)' "$TRACE"; then
      cat "$TRACE" >&2; echo "门禁失败后仍执行有状态操作" >&2; exit 1
    fi
  fi
done
bash -n "$SCRIPT_DIR/deploy.sh"
echo "部署 Prisma 准备、顺序及失败截止测试通过"
