#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/wenyousite-openapi-tool-test.XXXXXX")
cleanup() {
  case "$TEST_ROOT" in
    "${TMPDIR:-/tmp}"/wenyousite-openapi-tool-test.*) rm -rf --one-file-system -- "$TEST_ROOT" ;;
    *) echo "拒绝清理非测试目录: $TEST_ROOT" >&2 ;;
  esac
}
trap cleanup EXIT INT TERM
mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/scratch"
cat >"$TEST_ROOT/bin/pnpm" <<'STUB'
#!/bin/bash
set -euo pipefail
printf '%s\n' "$*" >>"$TRACE"
case "$1" in
  openapi:export)
    printf '%s\n' "$2" >"$TRACE.path"
    printf '{}\n' >"$2"
    # 保持两个并发调用同时存活，才能捕获共享临时路径的回归。
    sleep 0.2
    if [ "${FAIL_STAGE:-}" = export ]; then exit 42; fi
    ;;
  exec)
    if [ "${FAIL_STAGE:-}" = contract ] && [ "$3" = scripts/check-openapi-contract.ts ]; then exit 43; fi
    ;;
  *) exit 99 ;;
esac
STUB
chmod +x "$TEST_ROOT/bin/pnpm"
run_case() {
  local name=$1 failure=$2
  TRACE="$TEST_ROOT/$name.trace" FAIL_STAGE="$failure" TMPDIR="$TEST_ROOT/scratch" \
    PATH="$TEST_ROOT/bin:$PATH" bash "$SCRIPT_DIR/check-openapi.sh"
}
run_case first none & first_pid=$!
run_case second none & second_pid=$!
wait "$first_pid"
wait "$second_pid"
first_path=$(cat "$TEST_ROOT/first.trace.path")
second_path=$(cat "$TEST_ROOT/second.trace.path")
[ "$first_path" != "$second_path" ] || { echo "并发契约检查复用了临时路径" >&2; exit 1; }
for name in first second; do
  output=$(cat "$TEST_ROOT/$name.trace.path")
  expected=$(printf 'openapi:export %s\nexec tsx scripts/check-openapi-contract.ts %s\nexec tsx scripts/check-contract-artifact.ts %s\nexec tsx scripts/check-contract-version.ts' "$output" "$output" "$output")
  [ "$(cat "$TEST_ROOT/$name.trace")" = "$expected" ] || { echo "契约检查链或参数遗漏" >&2; exit 1; }
  [ ! -e "${output%/*}" ] || { echo "成功后遗留临时目录" >&2; exit 1; }
done
for stage in export contract; do
  status=0
  run_case "$stage" "$stage" || status=$?
  expected=42; lines=1
  if [ "$stage" = contract ]; then expected=43; lines=2; fi
  [ "$status" -eq "$expected" ] && [ "$(wc -l <"$TEST_ROOT/$stage.trace")" -eq "$lines" ] || {
    echo "失败后继续检查或丢失原退出码: $stage" >&2; exit 1;
  }
  output=$(cat "$TEST_ROOT/$stage.trace.path")
  [ ! -e "${output%/*}" ] || { echo "失败后遗留临时目录" >&2; exit 1; }
done
echo "OpenAPI 并发临时目录、检查链和失败清理测试通过"
