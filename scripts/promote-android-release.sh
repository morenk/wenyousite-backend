#!/usr/bin/env bash
set -euo pipefail

BACKEND_DIR=${WENYOU_BACKEND_DIR:-/root/wenyousite/wenyousite-backend}
ENV_FILE=${BACKEND_ENV_FILE:-$BACKEND_DIR/.env}
HISTORY_FILE=${MOBILE_RELEASE_HISTORY_FILE:-/var/lib/wenyousite/mobile-release-history.tsv}
ALLOWED_BASE_URL=${MOBILE_RELEASE_ALLOWED_BASE_URL:-https://wenyou-apk.cn-nb1.rains3.com/mobile/android}
BACKEND_SERVICE=${MOBILE_RELEASE_BACKEND_SERVICE:-wenyousite-backend.service}
NODE_BINARY=${MOBILE_RELEASE_NODE_BINARY:-/root/.local/share/fnm/node-versions/v24.18.0/installation/bin/node}
CURL_BIN=${MOBILE_RELEASE_CURL_BIN:-curl}
SKIP_RESTART=${MOBILE_RELEASE_SKIP_RESTART:-false}

MODE=promote
VERSION_NAME=
BUILD_NUMBER=
UPDATE_URL=
APK_SIZE=
APK_SHA256=

usage() {
  cat <<'EOF'
晋级已上传到对象存储的 Android 构建：
  promote-android-release.sh \
    --version 0.3.0-dev.36 \
    --build 42 \
    --url https://wenyou-apk.cn-nb1.rains3.com/mobile/android/wenyou-0.3.0-dev.36-42.apk \
    --size 90900000 \
    --sha256 <64 hex>

撤回当前推荐与强制升级策略：
  promote-android-release.sh --withdraw
EOF
}

if [ "${1:-}" = --withdraw ]; then
  if [ "$#" -ne 1 ]; then usage >&2; exit 2; fi
  MODE=withdraw
  shift
else
  while (($# > 0)); do
    case "$1" in
      --version) VERSION_NAME=${2:-}; shift 2 ;;
      --build) BUILD_NUMBER=${2:-}; shift 2 ;;
      --url) UPDATE_URL=${2:-}; shift 2 ;;
      --size) APK_SIZE=${2:-}; shift 2 ;;
      --sha256) APK_SHA256=${2:-}; shift 2 ;;
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
if [ "$MODE" = promote ]; then
  if [[ ! "$VERSION_NAME" =~ ^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$ ]]; then
    echo "version 格式不合法" >&2
    exit 2
  fi
  if [[ ! "$BUILD_NUMBER" =~ ^[1-9][0-9]*$ ]] || ((BUILD_NUMBER > 2100000000)); then
    echo "build 格式不合法" >&2
    exit 2
  fi
  if [[ ! "$APK_SIZE" =~ ^[1-9][0-9]*$ ]]; then
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
  META_JSON=$meta MODE=$MODE EXPECTED_BUILD=$BUILD_NUMBER EXPECTED_URL=$UPDATE_URL "$NODE_BINARY" <<'NODE'
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
  systemctl restart "$BACKEND_SERVICE"
  systemctl is-active --quiet "$BACKEND_SERVICE"
  wait_for_health
  verify_meta
}

restore_backend() {
  systemctl restart "$BACKEND_SERVICE"
  systemctl is-active --quiet "$BACKEND_SERVICE"
  wait_for_health
  $CURL_BIN --fail --silent --show-error https://wenyou.site/api/v1/health >/dev/null
}

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
      echo "Android 构建已处于推荐状态: $BUILD_NUMBER"
      exit 0
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

ENV_BACKUP=$(mktemp "${ENV_FILE}.mobile-release-backup.XXXXXX")
ENV_NEXT=$(mktemp "${ENV_FILE}.mobile-release-next.XXXXXX")
cleanup() { rm -f -- "$ENV_BACKUP" "$ENV_NEXT"; }
trap cleanup EXIT
cp -p -- "$ENV_FILE" "$ENV_BACKUP"
if [ "$MODE" = promote ]; then
  write_policy "$ENV_NEXT" true
else
  write_policy "$ENV_NEXT" false
fi
mv -- "$ENV_NEXT" "$ENV_FILE"

if [ "$SKIP_RESTART" != true ]; then
  if ! restart_and_verify; then
    echo "移动版本策略生效失败，正在恢复旧配置" >&2
    cp -p -- "$ENV_BACKUP" "$ENV_FILE"
    restore_backend || true
    exit 1
  fi
fi

if [ "$MODE" = promote ]; then
  printf '%s\tpromote\tandroid\t%s\t%s\t%s\t%s\t%s\n' \
    "$(date --utc +'%Y-%m-%dT%H:%M:%SZ')" "$VERSION_NAME" "$BUILD_NUMBER" "$APK_SHA256" "$APK_SIZE" "$UPDATE_URL" >> "$HISTORY_FILE"
  echo "Android 推荐版本晋级完成: $BUILD_NUMBER"
  echo "url=$UPDATE_URL"
else
  printf '%s\twithdraw\tandroid\t%s\t%s\n' \
    "$(date --utc +'%Y-%m-%dT%H:%M:%SZ')" "${CURRENT_RECOMMENDED:-}" "${CURRENT_URL:-}" >> "$HISTORY_FILE"
  echo "Android 移动版本策略已撤回"
fi
chmod 0644 "$HISTORY_FILE"
