#!/usr/bin/env bash
set -euo pipefail

RELEASE_DIR=${WENYOU_BACKEND_RELEASE_DIR:-/var/lib/wenyousite/backend/current}
NODE_BINARY=${WENYOU_NODE_BINARY:-$RELEASE_DIR/bin/node}
REVISION_FILE=${WENYOU_BACKEND_REVISION_FILE:-$RELEASE_DIR/BUILD_SHA}
ENV_FILE=${WENYOU_BACKEND_ENV_FILE:-/etc/wenyousite/backend.env}

if [ ! -d "$RELEASE_DIR" ]; then
  echo "后端 release 不存在: $RELEASE_DIR" >&2
  exit 1
fi
if [ ! -x "$NODE_BINARY" ]; then
  echo "Node 不可执行: $NODE_BINARY" >&2
  exit 1
fi
if [ ! -f "$RELEASE_DIR/dist/main.js" ]; then
  echo "后端 production build 不存在: $RELEASE_DIR/dist/main.js" >&2
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "后端环境文件不存在: $ENV_FILE" >&2
  exit 1
fi
if [ -n "${DIRECT_DATABASE_URL:-}" ]; then
  echo "运行进程不得继承数据库 owner 直连凭据" >&2
  exit 1
fi
if [ ! -f "$REVISION_FILE" ]; then
  echo "后端 revision 文件不存在: $REVISION_FILE" >&2
  exit 1
fi

BUILD_SHA=$(<"$REVISION_FILE")
if [[ ! "$BUILD_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "后端 revision 不是完整 Git SHA: $REVISION_FILE" >&2
  exit 1
fi
cd "$RELEASE_DIR"
exec env NODE_ENV=production BUILD_SHA="$BUILD_SHA" "$NODE_BINARY" dist/main
