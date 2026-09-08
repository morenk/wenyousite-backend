#!/usr/bin/env bash
set -euo pipefail

BACKEND_DIR=${WENYOU_BACKEND_DIR:-/var/lib/wenyousite/loadtest/current}
NODE_BINARY=${WENYOU_NODE_BINARY:-/usr/local/bin/node}

if [ ! -d "$BACKEND_DIR" ]; then
  echo "后端目录不存在: $BACKEND_DIR" >&2
  exit 1
fi
if [ ! -x "$NODE_BINARY" ]; then
  echo "Node 不可执行: $NODE_BINARY" >&2
  exit 1
fi
if [ ! -f "$BACKEND_DIR/dist/image-worker.js" ]; then
  echo "图片 Worker production build 不存在: $BACKEND_DIR/dist/image-worker.js" >&2
  exit 1
fi

cd "$BACKEND_DIR"
exec "$NODE_BINARY" dist/image-worker
