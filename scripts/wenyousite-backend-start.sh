#!/usr/bin/env bash
set -euo pipefail

BACKEND_DIR=${WENYOU_BACKEND_DIR:-/root/wenyousite/wenyousite-backend}
NODE_BINARY=${WENYOU_NODE_BINARY:-/root/.local/share/fnm/node-versions/v24.18.0/installation/bin/node}
REVISION_FILE=${WENYOU_BACKEND_REVISION_FILE:-/var/lib/wenyousite/backend/current-revision}

if [ ! -d "$BACKEND_DIR" ]; then
  echo "后端目录不存在: $BACKEND_DIR" >&2
  exit 1
fi
if [ ! -x "$NODE_BINARY" ]; then
  echo "Node 不可执行: $NODE_BINARY" >&2
  exit 1
fi
if [ ! -f "$BACKEND_DIR/dist/main.js" ]; then
  echo "后端 production build 不存在: $BACKEND_DIR/dist/main.js" >&2
  exit 1
fi
if [ ! -f "$BACKEND_DIR/.env" ]; then
  echo "后端环境文件不存在: $BACKEND_DIR/.env" >&2
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
cd "$BACKEND_DIR"
exec env NODE_ENV=production BUILD_SHA="$BUILD_SHA" "$NODE_BINARY" dist/main
