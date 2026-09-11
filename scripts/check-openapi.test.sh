#!/usr/bin/env bash
set -euo pipefail
fixture_dir="$(mktemp -d)"
trap 'rm -rf -- "$fixture_dir"' EXIT
mkdir "$fixture_dir/bin" "$fixture_dir/tmp"
cat > "$fixture_dir/bin/pnpm" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == openapi:export ]]; then
  printf '%s\n' "$2" >> "$OPENAPI_TEST_LOG"
  [[ "${OPENAPI_TEST_FAIL:-0}" == 1 ]] && exit 7
  printf '{}\n' > "$2"
elif [[ "$3" != scripts/check-contract-version.ts ]]; then
  [[ -f "$4" ]]
fi
STUB
chmod +x "$fixture_dir/bin/pnpm"
export PATH="$fixture_dir/bin:$PATH"
export TMPDIR="$fixture_dir/tmp"
export OPENAPI_TEST_LOG="$fixture_dir/paths"
bash scripts/check-openapi.sh &
first_pid=$!
bash scripts/check-openapi.sh &
second_pid=$!
wait "$first_pid"
wait "$second_pid"
[[ "$(sort -u "$OPENAPI_TEST_LOG" | wc -l)" -eq 2 ]]
[[ -z "$(find "$TMPDIR" -mindepth 1 -print -quit)" ]]
if OPENAPI_TEST_FAIL=1 bash scripts/check-openapi.sh; then
  echo '导出失败必须传递失败状态' >&2
  exit 1
else
  [[ "$?" -eq 7 ]]
fi
[[ -z "$(find "$TMPDIR" -mindepth 1 -print -quit)" ]]
echo 'OpenAPI 检查并发隔离与失败清理通过'
