#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=${BACKEND_ENV_FILE:-/etc/wenyousite/backend.env}
HISTORY_FILE=${MOBILE_RELEASE_HISTORY_FILE:-/var/lib/wenyousite/mobile-release-history.tsv}
ALLOWED_BASE_URL=${MOBILE_RELEASE_ALLOWED_BASE_URL:-https://wenyou-apk.cn-nb1.rains3.com/mobile/android}
BACKEND_SERVICE=${MOBILE_RELEASE_BACKEND_SERVICE:-wenyousite-backend.service}
RELEASE_ROOT=/var/lib/wenyousite/backend/current
NODE_BINARY=${MOBILE_RELEASE_NODE_BINARY:-$RELEASE_ROOT/bin/node}
NOTES_HELPER=${MOBILE_RELEASE_NOTES_HELPER:-$RELEASE_ROOT/dist/mobile-releases/mobile-release-cli.js}
CURL_BIN=${MOBILE_RELEASE_CURL_BIN:-curl}
SKIP_RESTART=${MOBILE_RELEASE_SKIP_RESTART:-false}

# sudo 入口不接受调用方自选路径、运行时或跳过核验；测试覆盖仅在非 root 临时目录运行。
if [ "$EUID" -eq 0 ]; then
  export PATH=/usr/sbin:/usr/bin:/sbin:/bin
  ENV_FILE=/etc/wenyousite/backend.env
  HISTORY_FILE=/var/lib/wenyousite/mobile-release-history.tsv
  ALLOWED_BASE_URL=https://wenyou-apk.cn-nb1.rains3.com/mobile/android
  BACKEND_SERVICE=wenyousite-backend.service
  NODE_BINARY=$RELEASE_ROOT/bin/node
  NOTES_HELPER=$RELEASE_ROOT/dist/mobile-releases/mobile-release-cli.js
  CURL_BIN=/usr/bin/curl
  SKIP_RESTART=false
fi

MODE=promote
VERSION_NAME=
BUILD_NUMBER=
UPDATE_URL=
APK_SIZE=
APK_SHA256=
NOTES_REVISION=

usage() {
  cat <<'EOF'
晋级已上传到对象存储的 Android 构建：
  promote-android-release.sh \
    --version 0.3.0-dev.36 \
    --build 42 \
    --url https://wenyou-apk.cn-nb1.rains3.com/mobile/android/wenyou-0.3.0-dev.36-42.apk \
    --size 90900000 \
    --sha256 <64 hex> \
    --notes-revision <预检返回的 confirmedRevision>

只读预检（构建前运行，stdout 仅输出 JSON）：
  promote-android-release.sh --preflight --version 0.3.0-dev.36 --build 42

恢复上次中断操作（只接受此参数，不发包、不晋级）：
  promote-android-release.sh --recover

撤回当前推荐与强制升级策略：
  promote-android-release.sh --withdraw
EOF
}

if [ "${1:-}" = --recover ]; then
  [ "$#" -eq 1 ] || { usage >&2; exit 2; }; MODE=recover; shift
elif [ "${1:-}" = --withdraw ]; then
  if [ "$#" -ne 1 ]; then usage >&2; exit 2; fi
  MODE=withdraw
  shift
else
  if [ "${1:-}" = --preflight ]; then MODE=preflight; shift; fi
  while (($# > 0)); do
    case "$1" in
      --version) VERSION_NAME=${2:-}; shift 2 ;;
      --build) BUILD_NUMBER=${2:-}; shift 2 ;;
      --url) UPDATE_URL=${2:-}; shift 2 ;;
      --size) APK_SIZE=${2:-}; shift 2 ;;
      --sha256) APK_SHA256=${2:-}; shift 2 ;;
      --notes-revision) NOTES_REVISION=${2:-}; shift 2 ;;
      --help|-h) usage; exit 0 ;;
      *) echo "未知参数: $1" >&2; usage >&2; exit 2 ;;
    esac
  done
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "后端环境文件不存在: $ENV_FILE" >&2
  exit 2
fi
if ! command -v "$CURL_BIN" >/dev/null 2>&1; then
  echo "无法执行 curl: $CURL_BIN" >&2
  exit 2
fi
if [ "$MODE" = promote ] || [ "$MODE" = preflight ]; then
  if [[ ! "$VERSION_NAME" =~ ^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$ ]]; then
    echo "version 格式不合法" >&2
    exit 2
  fi
  if [[ ! "$BUILD_NUMBER" =~ ^[1-9][0-9]{0,9}$ ]] || ((BUILD_NUMBER > 2100000000)); then
    echo "build 格式不合法" >&2
    exit 2
  fi
fi
if [ "$MODE" = preflight ] && { [ -n "$APK_SIZE$APK_SHA256$UPDATE_URL$NOTES_REVISION" ]; }; then
  echo "预检只接受 version/build" >&2; exit 2
fi
if [ "$MODE" = promote ]; then
  if [[ ! "$NOTES_REVISION" =~ ^[1-9][0-9]{0,9}$ ]] || ((NOTES_REVISION > 2147483646)); then
    echo "必须提供预检确认 revision" >&2; exit 2
  fi
  if [[ ! "$APK_SIZE" =~ ^[1-9][0-9]{0,14}$ ]]; then
    echo "APK size 格式不合法" >&2
    exit 2
  fi
  APK_SHA256=$(printf '%s' "$APK_SHA256" | tr '[:upper:]' '[:lower:]')
  if [[ ! "$APK_SHA256" =~ ^[0-9a-f]{64}$ ]]; then
    echo "APK SHA-256 格式不合法" >&2
    exit 2
  fi
  EXPECTED_FILE="wenyou-${VERSION_NAME}-${BUILD_NUMBER}.apk"
  EXPECTED_URL="${ALLOWED_BASE_URL%/}/${EXPECTED_FILE}"
  if [ "$UPDATE_URL" != "$EXPECTED_URL" ]; then
    echo "更新地址不在允许的 RainS3 路径或与版本不一致" >&2
    exit 2
  fi
fi

if [ "$EUID" -eq 0 ]; then
  # 与后端部署共用锁，固定整个操作期间的 release/环境/数据库 schema。
  exec 8</var/lib/wenyousite/deploy.lock
  if [ "$MODE" = preflight ]; then flock -sn 8; else flock -n 8; fi
fi

notes_command() {
  local action=$1
  local payload=$2
  if [ "$EUID" -eq 0 ]; then
    local resolved path
    resolved=$(readlink -f -- "$RELEASE_ROOT")
    [[ "$resolved" =~ ^/var/lib/wenyousite/backend/releases/[0-9a-f]{40}$ ]] || return 1
    # 部署已完整检查依赖树；调用前再检查固定入口及祖先的所有权和可写位。
    for path in "$NODE_BINARY" "$NOTES_HELPER" "$RELEASE_ROOT/node_modules"; do
      path=$(readlink -f -- "$path") || return 1
      [[ "$path" = "$resolved"/* ]] || return 1
      while [ "$path" != / ]; do
        [ "$(stat -c %u -- "$path")" = 0 ] || return 1
        (( (8#$(stat -c %a -- "$path") & 0022) == 0 )) || return 1
        path=$(dirname -- "$path")
      done
    done
  fi
  printf '%s' "$payload" | env -i PATH=/usr/bin:/bin "$NODE_BINARY" "$NOTES_HELPER" "$action" "$ENV_FILE"
}
if [ "$MODE" = preflight ]; then
  notes_command preflight "{\"platform\":\"android\",\"versionName\":\"$VERSION_NAME\",\"buildNumber\":$BUILD_NUMBER}"
  exit $?
fi

install -d -m 0755 "$(dirname -- "$HISTORY_FILE")"
LOCK_FILE="$(dirname -- "$HISTORY_FILE")/.mobile-release.lock"
exec 9> "$LOCK_FILE"
if ! flock -n 9; then
  echo "已有移动版本晋级任务正在运行" >&2
  exit 1
fi

read_env_value() {
  local key=$1
  local raw
  raw=$(sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1)
  raw=${raw#\"}; raw=${raw%\"}; raw=${raw#\'}; raw=${raw%\'}
  printf '%s' "$raw"
}

header_value() {
  local headers=$1
  local name=$2
  printf '%s\n' "$headers" | tr -d '\r' | awk -v target="$name" '
    BEGIN { IGNORECASE = 1 }
    index(tolower($0), tolower(target) ":") == 1 {
      sub(/^[^:]*:[[:space:]]*/, "")
      value = $0
    }
    END { print value }
  '
}

validate_public_object() {
  local headers
  local value
  local sidecar
  local sidecar_sha
  local sidecar_file

  headers=$($CURL_BIN --fail --silent --show-error --head --max-time 20 "$UPDATE_URL")
  value=$(header_value "$headers" content-type)
  if [ "${value%%;*}" != application/vnd.android.package-archive ]; then
    echo "公网 APK Content-Type 不正确" >&2
    return 1
  fi
  if [ "$(header_value "$headers" content-length)" != "$APK_SIZE" ]; then
    echo "公网 APK Content-Length 与本地构建不一致" >&2
    return 1
  fi
  value=$(printf '%s' "$(header_value "$headers" cache-control)" | tr '[:upper:]' '[:lower:]')
  for directive in public max-age=31536000 immutable; do
    if [[ "$value" != *"$directive"* ]]; then
      echo "公网 APK 缺少缓存指令 $directive" >&2
      return 1
    fi
  done
  value=$(header_value "$headers" content-disposition)
  if [[ "${value,,}" != *attachment* ]] || [[ "$value" != *"$EXPECTED_FILE"* ]]; then
    echo "公网 APK Content-Disposition 不正确" >&2
    return 1
  fi
  if [ "$(printf '%s' "$(header_value "$headers" x-amz-meta-apk-sha256)" | tr '[:upper:]' '[:lower:]')" != "$APK_SHA256" ]; then
    echo "公网 APK SHA-256 metadata 不一致" >&2
    return 1
  fi
  if [ "$(header_value "$headers" x-amz-meta-application-id)" != site.wenyou.app ] || \
    [ "$(header_value "$headers" x-amz-meta-version-name)" != "$VERSION_NAME" ] || \
    [ "$(header_value "$headers" x-amz-meta-version-code)" != "$BUILD_NUMBER" ]; then
    echo "公网 APK 应用或版本 metadata 不一致" >&2
    return 1
  fi

  sidecar=$($CURL_BIN --fail --silent --show-error --max-time 20 "${UPDATE_URL}.sha256")
  read -r sidecar_sha sidecar_file _ <<< "$sidecar"
  sidecar_sha=$(printf '%s' "$sidecar_sha" | tr '[:upper:]' '[:lower:]')
  sidecar_file=${sidecar_file#\*}
  if [ "$sidecar_sha" != "$APK_SHA256" ] || [ "$sidecar_file" != "$EXPECTED_FILE" ]; then
    echo "公网 SHA sidecar 与待晋级 APK 不一致" >&2
    return 1
  fi
}

write_policy() {
  local next_file=$1
  local include_release=$2
  awk '
    !/^MOBILE_ANDROID_MIN_SUPPORTED_BUILD=/ &&
    !/^MOBILE_ANDROID_RECOMMENDED_BUILD=/ &&
    !/^MOBILE_ANDROID_UPDATE_URL=/
  ' "$ENV_FILE" > "$next_file"
  if [ "$include_release" = true ]; then
    local current_minimum
    current_minimum=$(read_env_value MOBILE_ANDROID_MIN_SUPPORTED_BUILD)
    if [ -n "$current_minimum" ]; then
      printf 'MOBILE_ANDROID_MIN_SUPPORTED_BUILD=%s\n' "$current_minimum" >> "$next_file"
    fi
    printf 'MOBILE_ANDROID_RECOMMENDED_BUILD=%s\n' "$BUILD_NUMBER" >> "$next_file"
    printf 'MOBILE_ANDROID_UPDATE_URL=%s\n' "$UPDATE_URL" >> "$next_file"
  fi
  chmod --reference="$ENV_FILE" "$next_file"
  chown --reference="$ENV_FILE" "$next_file"
}

wait_for_health() {
  local attempt
  for attempt in $(seq 1 30); do
    if $CURL_BIN --fail --silent --max-time 5 http://127.0.0.1:3000/api/v1/health >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

verify_meta() {
  local meta
  if [ ! -x "$NODE_BINARY" ]; then
    echo "Node 不可执行: $NODE_BINARY" >&2
    return 1
  fi
  meta=$($CURL_BIN --fail --silent --show-error http://127.0.0.1:3000/api/v1/meta)
  env -i PATH=/usr/bin:/bin META_JSON="$meta" MODE="$MODE" EXPECTED_BUILD="$BUILD_NUMBER" EXPECTED_URL="$UPDATE_URL" "$NODE_BINARY" <<'NODE'
const body = JSON.parse(process.env.META_JSON);
const android = body?.data?.mobileCompatibility?.android;
if (!android) process.exit(1);
if (process.env.MODE === 'withdraw') {
  if (android.minimumSupportedBuild !== null || android.recommendedBuild !== null || android.updateUrl !== null) process.exit(1);
} else {
  if (android.recommendedBuild !== Number(process.env.EXPECTED_BUILD)) process.exit(1);
  if (android.updateUrl !== process.env.EXPECTED_URL) process.exit(1);
}
NODE
  $CURL_BIN --fail --silent --show-error https://wenyou.site/api/v1/health >/dev/null
}

restart_and_verify() {
  systemctl restart "$BACKEND_SERVICE" || return 1
  systemctl is-active --quiet "$BACKEND_SERVICE" || return 1
  wait_for_health || return 1
  verify_meta
}

verify_restored_policy() {
  local meta
  meta=$($CURL_BIN --fail --silent --show-error --max-time 20 http://127.0.0.1:3000/api/v1/meta) || return 1
  printf '%s' "$meta" | env -i PATH=/usr/bin:/bin EXPECTED_BUILD="$(read_env_value MOBILE_ANDROID_RECOMMENDED_BUILD)" EXPECTED_MIN="$(read_env_value MOBILE_ANDROID_MIN_SUPPORTED_BUILD)" EXPECTED_URL="$(read_env_value MOBILE_ANDROID_UPDATE_URL)" "$NODE_BINARY" -e '
    let text="";process.stdin.on("data",x=>text+=x);process.stdin.on("end",()=>{
      const a=JSON.parse(text).data?.mobileCompatibility?.android;
      if(!a || a.recommendedBuild!==(Number(process.env.EXPECTED_BUILD)||null) || a.minimumSupportedBuild!==(Number(process.env.EXPECTED_MIN)||null) || a.updateUrl!==(process.env.EXPECTED_URL||null)) process.exit(1);
    });'
}

restore_backend() {
  systemctl restart "$BACKEND_SERVICE" || return 1
  systemctl is-active --quiet "$BACKEND_SERVICE" || return 1
  wait_for_health || return 1
  verify_restored_policy || return 1
  $CURL_BIN --fail --silent --show-error https://wenyou.site/api/v1/health >/dev/null
}

JOURNAL="$(dirname -- "$HISTORY_FILE")/.mobile-release.pending"
ENV_NEXT="${ENV_FILE}.mobile-release-next"
OPERATION_ID=
restore_journal() {
  [ -d "$JOURNAL" ] || return 0
  local result token status_failed=false
  if [ -f "$JOURNAL/operation" ]; then
    token=$(cat "$JOURNAL/operation")
    [[ "$token" =~ ^[0-9a-f-]{36}$ ]] || return 1
    result=$(notes_command status "{\"operationId\":\"$token\"}") || status_failed=true
    if [ "$result" = '{"status":"SUCCEEDED"}' ]; then
      rm -rf -- "$JOURNAL"
      return 0
    fi
  fi
  if [ -f "$JOURNAL/policy-started" ]; then
    cp -p -- "$JOURNAL/backend.env" "$ENV_NEXT" || return 1
    sync -f "$ENV_NEXT" || return 1
    mv -fT -- "$ENV_NEXT" "$ENV_FILE" || return 1
    if [ -f "$JOURNAL/history.tsv" ]; then
      cp -p -- "$JOURNAL/history.tsv" "$HISTORY_FILE" || return 1
    elif [ -e "$HISTORY_FILE" ]; then
      rm -- "$HISTORY_FILE" || return 1
    fi
    if [ "$SKIP_RESTART" != true ]; then restore_backend || return 1; fi
  fi
  [ "$status_failed" = false ] || return 1
  if [ -n "${token:-}" ]; then notes_command abort "{\"operationId\":\"$token\"}" >/dev/null || return 1; fi
  rm -rf -- "$JOURNAL"
}
# 异常终止后先恢复原策略/登记，再释放数据库锁；失败保留 journal，拒绝下一次晋级。
restore_journal || { echo "上次发布补偿未完成，保留恢复记录" >&2; exit 1; }

if [ "$MODE" = recover ]; then echo '{"schemaVersion":1,"recovered":true}'; exit 0; fi

CURRENT_RECOMMENDED=$(read_env_value MOBILE_ANDROID_RECOMMENDED_BUILD)
CURRENT_MINIMUM=$(read_env_value MOBILE_ANDROID_MIN_SUPPORTED_BUILD)
CURRENT_URL=$(read_env_value MOBILE_ANDROID_UPDATE_URL)

if [ "$MODE" = promote ]; then
  validate_public_object
  if [ -n "$CURRENT_RECOMMENDED" ]; then
    if [[ ! "$CURRENT_RECOMMENDED" =~ ^[1-9][0-9]*$ ]]; then
      echo "现有推荐构建号无效" >&2
      exit 2
    fi
    if ((BUILD_NUMBER < CURRENT_RECOMMENDED)); then
      echo "拒绝晋级较低构建号: 当前 $CURRENT_RECOMMENDED，待晋级 $BUILD_NUMBER" >&2
      exit 2
    fi
    if ((BUILD_NUMBER == CURRENT_RECOMMENDED)); then
      if [ "$CURRENT_URL" != "$UPDATE_URL" ]; then
        echo "同一构建号不能关联不同 URL" >&2
        exit 2
      fi
      : # 同 build 必须继续校验说明、APK 身份与发布登记。
    fi
  fi
  if [ -n "$CURRENT_MINIMUM" ] && ((BUILD_NUMBER < CURRENT_MINIMUM)); then
    echo "待晋级构建号不能低于最低支持构建号 $CURRENT_MINIMUM" >&2
    exit 2
  fi
elif [ -z "$CURRENT_RECOMMENDED" ] && [ -z "$CURRENT_MINIMUM" ] && [ -z "$CURRENT_URL" ]; then
  echo "Android 移动版本策略已经撤回"
  exit 0
fi

umask 077
JOURNAL_STAGING=$(mktemp -d "${JOURNAL}.prepare.XXXXXX")
cp -p -- "$ENV_FILE" "$JOURNAL_STAGING/backend.env"
sync -f "$JOURNAL_STAGING/backend.env"
if [ -f "$HISTORY_FILE" ]; then cp -p -- "$HISTORY_FILE" "$JOURNAL_STAGING/history.tsv"; sync -f "$JOURNAL_STAGING/history.tsv"; fi
mv -T -- "$JOURNAL_STAGING" "$JOURNAL"
sync -f "$(dirname -- "$JOURNAL")"
cleanup() {
  local code=$?
  trap - EXIT INT TERM
  if [ "$code" -ne 0 ]; then
    echo "移动发布失败，正在补偿原策略及登记" >&2
    restore_journal || echo "补偿失败；恢复记录和数据库发布锁已保留，重试将先恢复" >&2
  fi
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [ "$MODE" = promote ]; then
  OPERATION_ID=$(cat /proc/sys/kernel/random/uuid)
  printf '%s' "$OPERATION_ID" > "$JOURNAL/operation"
  sync -f "$JOURNAL/operation"
  notes_command begin "{\"platform\":\"android\",\"versionName\":\"$VERSION_NAME\",\"buildNumber\":$BUILD_NUMBER,\"confirmedRevision\":$NOTES_REVISION,\"operationId\":\"$OPERATION_ID\",\"apkSha256\":\"$APK_SHA256\",\"apkSize\":\"$APK_SIZE\",\"updateUrl\":\"$UPDATE_URL\"}" >/dev/null
fi
if [ "$MODE" = promote ]; then write_policy "$ENV_NEXT" true; else write_policy "$ENV_NEXT" false; fi
sync -f "$ENV_NEXT"
touch "$JOURNAL/policy-started"
sync -f "$JOURNAL/policy-started"
mv -fT -- "$ENV_NEXT" "$ENV_FILE"
if [ "$SKIP_RESTART" != true ]; then restart_and_verify; fi

# TSV 以替换方式提交；任何失败均进入补偿。公开说明只在策略核验和登记成功后出现。
if [ -f "$HISTORY_FILE" ]; then cp -- "$HISTORY_FILE" "$JOURNAL/next.tsv"; else touch "$JOURNAL/next.tsv"; fi
if [ "$MODE" = promote ]; then
  history_match=0
  awk -F '\t' -v build="$BUILD_NUMBER" -v version="$VERSION_NAME" -v sha="$APK_SHA256" -v size="$APK_SIZE" -v url="$UPDATE_URL" '
    $2 == "promote" && $3 == "android" && $5 == build {
      found=1; if ($4 != version || $6 != sha || $7 != size || $8 != url) mismatch=1
    }
    END { exit mismatch ? 2 : (found ? 0 : 1) }
  ' "$JOURNAL/next.tsv" || history_match=$?
  if [ "$history_match" -eq 2 ]; then echo "历史登记与本次 APK 身份不符" >&2; exit 1; fi
  if [ "$history_match" -ne 0 ]; then
    printf '%s\tpromote\tandroid\t%s\t%s\t%s\t%s\t%s\n' \
      "$(date --utc +'%Y-%m-%dT%H:%M:%SZ')" "$VERSION_NAME" "$BUILD_NUMBER" "$APK_SHA256" "$APK_SIZE" "$UPDATE_URL" >> "$JOURNAL/next.tsv"
  fi
else
  printf '%s\twithdraw\tandroid\t%s\t%s\n' \
    "$(date --utc +'%Y-%m-%dT%H:%M:%SZ')" "${CURRENT_RECOMMENDED:-}" "${CURRENT_URL:-}" >> "$JOURNAL/next.tsv"
fi
chmod 0644 "$JOURNAL/next.tsv"
sync -f "$JOURNAL/next.tsv"
mv -fT -- "$JOURNAL/next.tsv" "$HISTORY_FILE"
if [ "$MODE" = promote ]; then
  notes_command publish "{\"operationId\":\"$OPERATION_ID\"}" >/dev/null
  notes_command commit "{\"operationId\":\"$OPERATION_ID\"}" >/dev/null
  if [ "$SKIP_RESTART" != true ]; then
    verify_meta
    public=$($CURL_BIN --fail --silent --show-error --max-time 20 "https://wenyou.site/api/v1/mobile-releases/android/$BUILD_NUMBER")
    printf '%s' "$public" | env -i PATH=/usr/bin:/bin EXPECTED_VERSION="$VERSION_NAME" EXPECTED_BUILD="$BUILD_NUMBER" EXPECTED_REVISION="$NOTES_REVISION" "$NODE_BINARY" -e '
      let text=""; process.stdin.on("data", x => text+=x); process.stdin.on("end",()=>{
        const d=JSON.parse(text).data;
        if(d?.platform!=="android" || d.versionName!==process.env.EXPECTED_VERSION || d.buildNumber!==Number(process.env.EXPECTED_BUILD) || d.revision!==Number(process.env.EXPECTED_REVISION)) process.exit(1);
      });'
  fi
  notes_command finish "{\"operationId\":\"$OPERATION_ID\"}" >/dev/null
fi
rm -rf -- "$JOURNAL"
echo "Android 移动版本操作完成: $MODE ${BUILD_NUMBER:-}"
