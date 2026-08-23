#!/usr/bin/env bash
set -euo pipefail

BACKEND_DIR=${WENYOU_BACKEND_DIR:-/root/wenyousite/wenyousite-backend}
NODE_BINARY=${WENYOU_NODE_BINARY:-/root/.local/share/fnm/node-versions/v24.18.0/installation/bin/node}

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

cd "$BACKEND_DIR"
exec "$NODE_BINARY" dist/main
