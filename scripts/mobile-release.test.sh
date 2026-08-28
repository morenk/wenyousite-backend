#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PROMOTE_SCRIPT="$SCRIPT_DIR/promote-android-release.sh"
DEPLOY_SCRIPT="$SCRIPT_DIR/deploy.sh"
grep -Fq 'ENV_FILE=${BACKEND_ENV_FILE:-/etc/wenyousite/backend.env}' "$PROMOTE_SCRIPT" || {
  echo "移动发布脚本必须默认更新 systemd 运行环境文件" >&2
  exit 1
}
grep -Fq 'install -m 0755 "$SCRIPT_DIR/promote-android-release.sh" /usr/local/sbin/wenyousite-promote-android' "$DEPLOY_SCRIPT" || {
  echo "后端部署必须同步安装移动发布脚本" >&2
  exit 1
}
TEST_ROOT=$(mktemp -d)
cleanup() { rm -rf -- "$TEST_ROOT"; }
trap cleanup EXIT

ENV_FILE="$TEST_ROOT/backend.env"
HISTORY_FILE="$TEST_ROOT/history.tsv"
FAKE_CURL="$TEST_ROOT/curl"
DIGEST=$(printf 'a%.0s' {1..64})
URL=https://wenyou-apk.cn-nb1.rains3.com/mobile/android/wenyou-0.3.0-dev.36-42.apk

cat > "$ENV_FILE" <<'EOF'
DATABASE_URL=postgresql://example.invalid/wenyou
MOBILE_ANDROID_MIN_SUPPORTED_BUILD=
MOBILE_ANDROID_RECOMMENDED_BUILD=
MOBILE_ANDROID_UPDATE_URL=
MOBILE_IOS_RECOMMENDED_BUILD=20
EOF

cat > "$FAKE_CURL" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
url=${!#}
if [[ " $* " == *" --head "* ]]; then
  cat <<HEADERS
HTTP/2 200
content-type: application/vnd.android.package-archive
content-length: 90900000
cache-control: public, max-age=31536000, immutable
content-disposition: attachment; filename="wenyou-0.3.0-dev.36-42.apk"
x-amz-meta-apk-sha256: ${FAKE_SHA}
x-amz-meta-application-id: site.wenyou.app
x-amz-meta-version-name: 0.3.0-dev.36
x-amz-meta-version-code: 42
HEADERS
elif [[ "$url" == *.sha256 ]]; then
  printf '%s  %s\n' "$FAKE_SHA" wenyou-0.3.0-dev.36-42.apk
else
  exit 1
fi
EOF
chmod 0700 "$FAKE_CURL"

promote() {
  FAKE_SHA="$DIGEST" \
    BACKEND_ENV_FILE="$ENV_FILE" \
    MOBILE_RELEASE_HISTORY_FILE="$HISTORY_FILE" \
    MOBILE_RELEASE_CURL_BIN="$FAKE_CURL" \
    MOBILE_RELEASE_SKIP_RESTART=true \
    bash "$SCRIPT_DIR/promote-android-release.sh" \
      --version 0.3.0-dev.36 \
      --build 42 \
      --url "$URL" \
      --size 90900000 \
      --sha256 "$DIGEST" >/dev/null
}

promote
test "$(sed -n 's/^MOBILE_ANDROID_RECOMMENDED_BUILD=//p' "$ENV_FILE")" = 42
test "$(sed -n 's/^MOBILE_ANDROID_UPDATE_URL=//p' "$ENV_FILE")" = "$URL"
test "$(sed -n 's/^MOBILE_IOS_RECOMMENDED_BUILD=//p' "$ENV_FILE")" = 20
promote
test "$(wc -l < "$HISTORY_FILE")" = 1

if FAKE_SHA="$DIGEST" BACKEND_ENV_FILE="$ENV_FILE" MOBILE_RELEASE_HISTORY_FILE="$HISTORY_FILE" \
  MOBILE_RELEASE_CURL_BIN="$FAKE_CURL" MOBILE_RELEASE_SKIP_RESTART=true \
  bash "$SCRIPT_DIR/promote-android-release.sh" \
    --version 0.3.0-dev.35 --build 41 \
    --url https://wenyou-apk.cn-nb1.rains3.com/mobile/android/wenyou-0.3.0-dev.35-41.apk \
    --size 90900000 --sha256 "$DIGEST" >/dev/null 2>&1; then
  echo "较低构建号不应晋级成功" >&2
  exit 1
fi

if FAKE_SHA="$DIGEST" BACKEND_ENV_FILE="$ENV_FILE" MOBILE_RELEASE_HISTORY_FILE="$HISTORY_FILE" \
  MOBILE_RELEASE_CURL_BIN="$FAKE_CURL" MOBILE_RELEASE_SKIP_RESTART=true \
  bash "$SCRIPT_DIR/promote-android-release.sh" \
    --version 0.3.0-dev.36 --build 42 --url "$URL" --size 90900000 \
    --sha256 "$(printf 'b%.0s' {1..64})" >/dev/null 2>&1; then
  echo "摘要不一致不应晋级成功" >&2
  exit 1
fi

BACKEND_ENV_FILE="$ENV_FILE" MOBILE_RELEASE_HISTORY_FILE="$HISTORY_FILE" \
  MOBILE_RELEASE_CURL_BIN="$FAKE_CURL" MOBILE_RELEASE_SKIP_RESTART=true \
  bash "$SCRIPT_DIR/promote-android-release.sh" --withdraw >/dev/null
test -z "$(sed -n 's/^MOBILE_ANDROID_RECOMMENDED_BUILD=//p' "$ENV_FILE")"
test -z "$(sed -n 's/^MOBILE_ANDROID_UPDATE_URL=//p' "$ENV_FILE")"
test "$(sed -n 's/^MOBILE_IOS_RECOMMENDED_BUILD=//p' "$ENV_FILE")" = 20
test "$(wc -l < "$HISTORY_FILE")" = 2

echo "mobile release promotion: ok"
